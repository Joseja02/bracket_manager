<?php

namespace App\Services;

use App\Models\User;
use App\Models\Report;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class StartggClient
{
  public function __construct(private StartggAuth $auth)
  {
  }

  public function query(User $user, string $query, array $variables = []): array
  {
    // Obtener un token válido, refrescándolo proactivamente si está cerca de expirar
    // Esto evita que el usuario tenga que autenticarse frecuentemente
    $token = $this->auth->getValidToken($user, 5); // Refrescar 5 minutos antes de expirar

    if (!$token) {
      Log::error('startgg no valid token available', [
        'user_id' => $user->id,
        'has_refresh_token' => !empty($user->startgg_refresh_token),
      ]);
      throw new RuntimeException('No valid access token available. Please re-authenticate.');
    }

    $doRequest = function ($token) use ($query, $variables) {
      return Http::withToken($token)
        ->acceptJson()
        ->timeout(20)
        ->connectTimeout(5)
        ->post(config('startgg.api_url_oauth'), [
          'query' => $query,
          'variables' => (object) $variables,
        ]);
    };

    $started = microtime(true);
    $resp = $doRequest($token);

    // Si aún así recibimos un 401, intentar refrescar una vez más (fallback)
    if ($resp->status() === 401) {
      Log::warning('startgg received 401 after proactive refresh, attempting emergency refresh', [
        'user_id' => $user->id,
      ]);
      $token = $this->auth->refresh($user) ?? $token;
      $resp = $doRequest($token);
    }

    $graphqlMs = (int) round((microtime(true) - $started) * 1000);
    $operation = null;
    if (preg_match('/(?:query|mutation)\s+(\w+)/i', $query, $matches)) {
      $operation = $matches[1];
    }
    Log::info('startgg graphql timing', [
      'op' => $operation,
      'ms' => $graphqlMs,
      'status' => $resp->status(),
      'user_id' => $user->id,
    ]);

    if ($resp->failed()) {
      $json = $resp->json();
      $errorMessage = 'Failed to call start.gg';

      // Extraer mensaje de error original de Start.gg
      if (!empty($json['errors']) && is_array($json['errors'])) {
        $firstError = $json['errors'][0] ?? null;
        if ($firstError && isset($firstError['message'])) {
          $errorMessage = $firstError['message'];
        }
      } elseif (!empty($json['error'])) {
        $errorMessage = is_string($json['error']) ? $json['error'] : json_encode($json['error']);
      } elseif (!empty($json['message'])) {
        $errorMessage = $json['message'];
      } else {
        // Intentar extraer del body si no hay JSON válido
        $body = $resp->body();
        if (!empty($body)) {
          $errorMessage = $body;
        }
      }

      Log::error('startgg graphql error', [
        'status' => $resp->status(),
        'body' => $resp->body(),
        'error_message' => $errorMessage,
      ]);

      throw new RuntimeException($errorMessage);
    }

    $json = $resp->json();
    if (!empty($json['errors'])) {
      Log::warning('startgg graphql errors', ['errors' => $json['errors']]);

      // Lanzar excepción con el primer error original de Start.gg
      $firstError = $json['errors'][0] ?? null;
      if ($firstError && isset($firstError['message'])) {
        throw new RuntimeException($firstError['message']);
      }
    }

    if (empty($json['data'])) {
      // Log full response body for debugging when data is empty
      Log::warning('startgg graphql empty data', [
        'status' => $resp->status(),
        'body' => $resp->body(),
        'user_id' => $user->id,
      ]);
    }

    return $json['data'] ?? [];
  }

  /**
   * Obtener owner de un torneo por slug usando el token del usuario
   */
  public function getTournamentOwnerId(User $user, string $slug): ?string
  {
    $query = <<<'GQL'
        query TournamentOwner($slug: String!) {
          tournament(slug: $slug) {
            owner { id }
          }
        }
        GQL;

    $data = $this->query($user, $query, ['slug' => $slug]);
    return data_get($data, 'tournament.owner.id');
  }

  /**
   * Roles de administración de start.gg que consideramos "colaboradores" del torneo.
   * Incluye singular y plural: la UI de start.gg usa a veces "Bracket Managers" /
   * "Reporters" mientras el schema GraphQL documenta formas en singular.
   * Ver https://help.start.gg/en/articles/13766145-admin-permissions
   */
  public const TOURNAMENT_ADMIN_ROLES = [
    'Administrator',
    'Manager',
    'Bracket Manager',
    'Bracket Managers',
    'Reporter',
    'Reporters',
  ];

  /**
   * Compara IDs de usuario de start.gg de forma tolerante (string/int y
   * posibles prefijos). Evita falsos negativos owner/colaborador.
   */
  public static function sameStartggUserId(string|int|null $a, string|int|null $b): bool
  {
    if ($a === null || $b === null || $a === '' || $b === '') {
      return false;
    }

    $normalize = static function (string|int $value): array {
      $raw = trim((string) $value);
      $digits = preg_replace('/\D+/', '', $raw) ?? '';
      return [$raw, $digits];
    };

    [$rawA, $digitsA] = $normalize($a);
    [$rawB, $digitsB] = $normalize($b);

    if ($rawA !== '' && $rawA === $rawB) {
      return true;
    }

    return $digitsA !== '' && $digitsA === $digitsB;
  }

  /**
   * Obtener owner y admins (todos los roles) de un torneo usando el token OAuth
   * del usuario. Como el campo `admins` es una "admin-only view", devuelve datos
   * cuando el propio solicitante es admin del torneo, permitiendo autoverificación.
   *
   * Se consultan dos fuentes independientes (cada una aislada para que un fallo
   * de permisos/scope no anule la otra) y se unen los IDs de usuario resultantes:
   *   1) tournament.admins(roles: [...]) → [User]
   *   2) tournament.participants(isAdmin: true) → participantes marcados admin
   *
   * Además, si la vista admin-only responde (owner o admins no vacíos) y el
   * usuario actual aparece en la lista — o es el owner — se marca isAdmin=true.
   */
  public function getTournamentAdminInfo(User $user, string $slug): array
  {
    $normalized = ltrim(preg_replace('/^tournament\//', '', $slug) ?? '', '/');
    $slugsToTry = array_values(array_unique(array_filter([$normalized, $slug])));

    $ownerId = null;
    $adminIds = [];
    $adminsFromRoles = [];
    $currentUserId = (string) ($user->startgg_user_id ?? '');

    foreach ($slugsToTry as $slugToUse) {
      try {
        $combinedQuery = <<<'GQL'
          query TournamentAdminInfo($slug: String!, $roles: [String], $page: Int!, $perPage: Int!) {
            tournament(slug: $slug) {
              owner { id }
              admins(roles: $roles) { id slug }
              participants(query: {page: $page, perPage: $perPage}, isAdmin: true) {
                nodes { user { id } }
              }
            }
          }
          GQL;

        $data = $this->query($user, $combinedQuery, [
          'slug' => $slugToUse,
          'roles' => self::TOURNAMENT_ADMIN_ROLES,
          'page' => 1,
          'perPage' => 100,
        ]);

        $ownerId = data_get($data, 'tournament.owner.id') ?? $ownerId;
        $rolesIds = collect(data_get($data, 'tournament.admins', []))
          ->map(fn ($admin) => (string) data_get($admin, 'id'))
          ->filter()
          ->all();
        $adminsFromRoles = array_merge($adminsFromRoles, $rolesIds);
        $adminIds = array_merge($adminIds, $rolesIds);
        $adminIds = array_merge($adminIds, collect(data_get($data, 'tournament.participants.nodes', []))
          ->map(fn ($node) => (string) data_get($node, 'user.id'))
          ->filter()
          ->all());
      } catch (\Throwable $e) {
        Log::info('start.gg combined admin lookup failed, falling back', [
          'slug' => $slugToUse,
          'user_id' => $user->id,
          'error' => $e->getMessage(),
        ]);

        try {
          $adminsQuery = <<<'GQL'
            query TournamentAdminsViaUser($slug: String!, $roles: [String]) {
              tournament(slug: $slug) {
                owner { id }
                admins(roles: $roles) { id slug }
              }
            }
            GQL;

          $data = $this->query($user, $adminsQuery, [
            'slug' => $slugToUse,
            'roles' => self::TOURNAMENT_ADMIN_ROLES,
          ]);

          $ownerId = data_get($data, 'tournament.owner.id') ?? $ownerId;
          $rolesIds = collect(data_get($data, 'tournament.admins', []))
            ->map(fn ($admin) => (string) data_get($admin, 'id'))
            ->filter()
            ->all();
          $adminsFromRoles = array_merge($adminsFromRoles, $rolesIds);
          $adminIds = array_merge($adminIds, $rolesIds);
        } catch (\Throwable $e2) {
          Log::info('start.gg user admins(roles) lookup failed (non-fatal)', [
            'slug' => $slugToUse,
            'user_id' => $user->id,
            'error' => $e2->getMessage(),
          ]);
        }

        try {
          $participantsQuery = <<<'GQL'
            query TournamentAdminParticipants($slug: String!, $page: Int!, $perPage: Int!) {
              tournament(slug: $slug) {
                owner { id }
                participants(query: {page: $page, perPage: $perPage}, isAdmin: true) {
                  nodes { user { id } }
                }
              }
            }
            GQL;

          $data = $this->query($user, $participantsQuery, [
            'slug' => $slugToUse,
            'page' => 1,
            'perPage' => 100,
          ]);

          $ownerId = data_get($data, 'tournament.owner.id') ?? $ownerId;
          $adminIds = array_merge($adminIds, collect(data_get($data, 'tournament.participants.nodes', []))
            ->map(fn ($node) => (string) data_get($node, 'user.id'))
            ->filter()
            ->all());
        } catch (\Throwable $e2) {
          Log::info('start.gg user participants(isAdmin) lookup failed (non-fatal)', [
            'slug' => $slugToUse,
            'user_id' => $user->id,
            'error' => $e2->getMessage(),
          ]);
        }
      }

      if ($ownerId || !empty($adminIds)) {
        break;
      }
    }

    $adminIds = array_values(array_unique($adminIds));
    $adminsFromRoles = array_values(array_unique($adminsFromRoles));

    $isAdmin = self::sameStartggUserId($ownerId, $currentUserId)
      || collect($adminIds)->contains(fn ($id) => self::sameStartggUserId($id, $currentUserId));

    Log::info('start.gg user admin lookup', [
      'slug' => $slug,
      'owner_id' => $ownerId,
      'admin_count' => count($adminIds),
      'admins_from_roles_count' => count($adminsFromRoles),
      'admins_sample' => array_slice($adminIds, 0, 5),
      'is_admin' => $isAdmin,
      'user_id' => $user->id,
    ]);

    return [
      'ownerId' => $ownerId,
      'adminIds' => $adminIds,
      'isAdmin' => $isAdmin,
    ];
  }

  /**
   * Run the query and return raw response for debugging
   */
  public function debugQuery(User $user, string $query, array $variables = []): array
  {
    // Usar getValidToken para asegurar que el token esté válido antes de hacer la petición
    $token = $this->auth->getValidToken($user, 5);

    if (!$token) {
      return [
        'status' => 401,
        'body' => json_encode(['error' => 'No valid token available']),
        'json' => ['error' => 'No valid token available'],
      ];
    }

    $resp = Http::withToken($token)
      ->acceptJson()
      ->post(config('startgg.api_url_oauth'), [
        'query' => $query,
        'variables' => (object) $variables,
      ]);

    return [
      'status' => $resp->status(),
      'body' => $resp->body(),
      'json' => $resp->json(),
    ];
  }

  /**
   * Obtener eventos del usuario actual
   */
  public function getUserEvents(User $user): array
  {
    $now = time();

    // Obtener TODOS los torneos del usuario sin filtros en la query
    $query = <<<'GQL'
        query AllTournaments($page: Int, $perPage: Int) {
          currentUser {
            id
            tournaments(query: {
              page: $page
              perPage: $perPage
            }) {
              nodes {
                id
                name
                slug
                startAt
                endAt
                events {
                  id
                  name
                  startAt
                  isOnline
                  state
                  videogame {
                    id
                  }
                }
              }
            }
          }
        }
        GQL;

    $data = $this->query($user, $query, ['page' => 1, 'perPage' => 50]);
    $allTournaments = data_get($data, 'currentUser.tournaments.nodes', []);

    $events = [];
    $eventIds = []; // Para evitar duplicados

    // Iterar sobre TODOS los torneos obtenidos
    foreach ($allTournaments as $tournament) {
      foreach ($tournament['events'] ?? [] as $event) {
        $eventId = $event['id'];

        // Evitar duplicados
        if (in_array($eventId, $eventIds)) {
          continue;
        }

        // Filtro 1: Solo eventos presenciales (no online)
        $isOnline = $event['isOnline'] ?? false;
        if ($isOnline) {
          continue;
        }

        // Filtro 2: Solo Smash Ultimate (videogame id 1386)
        $isSmashUltimate = data_get($event, 'videogame.id') == 1386;
        if (!$isSmashUltimate) {
          continue;
        }

        // Obtener fechas
        $startAt = $event['startAt'] ?? $tournament['startAt'];
        // event.endAt may not exist; use tournament.endAt as fallback
        $endAt = $tournament['endAt'] ?? null;
        $eventState = $event['state'] ?? null;

        // Filtro 3: Solo eventos ACTIVOS o PRÓXIMOS
        // ACTIVO: eventState == 2 OR (startAt <= ahora < endAt when endAt is available)
        // PRÓXIMO: aún no comenzó (startAt > ahora)
        $isActive = ($eventState === 2) || ($endAt !== null && $startAt <= $now && $now < $endAt);
        $isUpcoming = ($startAt > $now);

        if (!$isActive && !$isUpcoming) {
          continue;
        }

        // Determinar estado
        $status = $isActive ? 'active' : 'upcoming';

        // Agregar evento
        $events[] = [
          'id' => $eventId,
          'name' => $event['name'],
          'game' => 'smash_ultimate',
          'tournamentName' => $tournament['name'],
          'tournamentSlug' => $tournament['slug'] ?? null,
          'startAt' => $startAt,
          'status' => $status,
        ];

        $eventIds[] = $eventId;
      }
    }

    // Ordenar por fecha (próximos primero)
    usort($events, function ($a, $b) {
      return ($a['startAt'] ?? 0) <=> ($b['startAt'] ?? 0);
    });

    return $events;
  }

  /**
   * Obtener información de un evento
   */
  public function getEvent(User $user, $eventId): array
  {
    // Primero obtenemos el torneo del evento para verificar permisos
    $query = <<<'GQL'
        query EventDetail($id: ID!) {
          event(id: $id) {
            id
            name
            slug
            startAt
            tournament {
              id
              name
              slug
              owner {
                id
              }
            }
            userEntrant {
              id
            }
          }
        }
        GQL;

    $data = $this->query($user, $query, ['id' => $eventId]);
    $event = data_get($data, 'event');

    if (!$event) {
      throw new RuntimeException('Event not found');
    }

    $tournamentId = data_get($event, 'tournament.id');
    $tournamentOwner = data_get($event, 'tournament.owner.id');
    $userId = (string) $user->startgg_user_id;

    // Solo el owner del torneo se considera admin aquí. Los admins delegados
    // se verifican en EventController::adminCheck / ChecksEventAdmin.
    $isAdmin = self::sameStartggUserId($tournamentOwner, $userId);
    $isAdminEvent = $isAdmin;

    Log::info('Event admin check', [
      'event_id' => $eventId,
      'tournament_id' => $tournamentId,
      'user_id' => $userId,
      'tournament_owner' => $tournamentOwner,
      'is_admin' => $isAdmin,
    ]);

    return [
      'id' => $event['id'],
      'name' => $event['name'],
      'game' => 'smash_ultimate',
      'tournamentName' => data_get($event, 'tournament.name'),
      'tournamentSlug' => data_get($event, 'tournament.slug'),
      'startAt' => $event['startAt'],
      'isAdmin' => $isAdmin,
      'isAdminEvent' => $isAdminEvent,
      'userEntrantId' => data_get($event, 'userEntrant.id'),
    ];
  }

  /**
   * Obtener sets de un evento.
   * Forma oficial: event.sets + SetFilters (no event.phases.sets ni participants.user).
   * https://developer.start.gg/docs/examples/queries/sets-in-event
   */
  public function getEventSets(User $user, $eventId, array $filters = []): array
  {
    $mine = !empty($filters['mine']);
    $userEntrantSelection = $mine
      ? "userEntrant {\n              id\n            }"
      : '';

    $query = <<<GQL
        query EventSets(\$eventId: ID!, \$page: Int!, \$perPage: Int!, \$filters: SetFilters) {
          event(id: \$eventId) {
            id
            name
            {$userEntrantSelection}
            sets(
              page: \$page
              perPage: \$perPage
              sortType: STANDARD
              filters: \$filters
            ) {
              pageInfo {
                totalPages
              }
              nodes {
                id
                fullRoundText
                round
                state
                phaseGroup {
                  id
                  displayIdentifier
                  phase {
                    id
                    name
                  }
                }
                slots {
                  entrant {
                    id
                    name
                  }
                }
              }
            }
          }
        }
        GQL;

    $setFilters = [
      'state' => [1, 2],
      'hideEmpty' => true,
    ];

    $perPage = 100;
    $page = 1;
    $allSets = [];
    $totalPages = 1;
    $eventName = 'Unknown Event';
    $userEntrantId = null;

    do {
      $data = $this->query($user, $query, [
        'eventId' => $eventId,
        'page' => $page,
        'perPage' => $perPage,
        'filters' => $setFilters,
      ]);

      if ($page === 1) {
        $eventName = data_get($data, 'event.name', 'Unknown Event');
        $userEntrantId = data_get($data, 'event.userEntrant.id');
      }

      $nodes = data_get($data, 'event.sets.nodes', []) ?: [];
      $allSets = array_merge($allSets, $nodes);
      $totalPages = (int) (data_get($data, 'event.sets.pageInfo.totalPages') ?: 1);
      $page++;
    } while ($page <= $totalPages && $page <= 50);

    $phaseIds = [];
    foreach ($allSets as $set) {
      $pid = data_get($set, 'phaseGroup.phase.id');
      if ($pid) {
        $phaseIds[(string) $pid] = true;
      }
    }
    $hasMultiplePhases = count($phaseIds) > 1;

    Log::info('Raw sets from start.gg', [
      'event_id' => $eventId,
      'total_phases' => count($phaseIds),
      'total_sets' => count($allSets),
      'first_set' => $allSets[0] ?? null,
    ]);

    $mapped = array_map(function ($set) use ($eventId, $eventName, $hasMultiplePhases) {
      $slots = $set['slots'] ?? [];
      $p1 = $slots[0] ?? null;
      $p2 = $slots[1] ?? null;

      $status = match ($set['state'] ?? 0) {
        1 => 'not_started',
        2 => 'in_progress',
        3 => 'completed',
        default => 'not_started',
      };

      $p1Name = data_get($p1, 'entrant.name');
      $p2Name = data_get($p2, 'entrant.name');

      $poolId = data_get($set, 'phaseGroup.id');
      $poolIdentifier = data_get($set, 'phaseGroup.displayIdentifier');
      $phaseId = data_get($set, 'phaseGroup.phase.id');
      $phaseName = data_get($set, 'phaseGroup.phase.name');

      $poolLabel = null;
      if ($poolIdentifier) {
        $poolLabel = $hasMultiplePhases && $phaseName
          ? "{$phaseName} · Pool {$poolIdentifier}"
          : "Pool {$poolIdentifier}";
      } elseif ($phaseName && $hasMultiplePhases) {
        $poolLabel = $phaseName;
      }

      return [
        'id' => $set['id'],
        'eventId' => $eventId,
        'eventName' => $eventName,
        'round' => $set['fullRoundText'] ?? 'Round ' . $set['round'],
        'bestOf' => 3,
        'p1' => [
          'userId' => null,
          'entrantId' => data_get($p1, 'entrant.id'),
          'name' => $p1Name ?? 'TBD',
        ],
        'p2' => [
          'userId' => null,
          'entrantId' => data_get($p2, 'entrant.id'),
          'name' => $p2Name ?? 'TBD',
        ],
        'status' => $status,
        'phaseId' => $phaseId,
        'phaseName' => $phaseName,
        'poolId' => $poolId,
        'poolIdentifier' => $poolIdentifier,
        'poolLabel' => $poolLabel,
      ];
    }, $allSets);

    // Filtrar sets que tengan ambos participantes asignados
    $filtered = array_values(array_filter($mapped, function ($set) {
      $hasP1 = $set['p1']['name'] !== 'TBD' && !empty($set['p1']['name']);
      $hasP2 = $set['p2']['name'] !== 'TBD' && !empty($set['p2']['name']);
      return $hasP1 && $hasP2;
    }));

    if (!empty($filters['mine']) && $userEntrantId) {
      $filtered = array_values(array_filter($filtered, function ($set) use ($userEntrantId) {
        return (string) ($set['p1']['entrantId'] ?? '') === (string) $userEntrantId
          || (string) ($set['p2']['entrantId'] ?? '') === (string) $userEntrantId;
      }));
    }

    // Contar sets filtrados por ronda
    $setsByRound = collect($filtered)->groupBy('round')->map->count();

    Log::info('Filtered sets', [
      'event_id' => $eventId,
      'total_mapped' => count($mapped),
      'total_filtered' => count($filtered),
      'sets_by_round' => $setsByRound,
      'first_filtered' => $filtered[0] ?? null,
      'sample_excluded' => array_slice(array_filter($mapped, function ($set) use ($filtered) {
        return !in_array($set['id'], array_column($filtered, 'id'));
      }), 0, 3),
    ]);

    return $filtered;
  }

  /**
   * Mapa slug → ID de personaje de start.gg (Smash Ultimate).
   * Fuente única de verdad al reportar games a start.gg.
   */
  private function characterMap(): array
  {
    return [
      'bayonetta' => 1271,
      'bowser_jr' => 1272,
      'bowser' => 1273,
      'captain_falcon' => 1274,
      'cloud' => 1275,
      'corrin' => 1276,
      'daisy' => 1277,
      'dark_pit' => 1278,
      'diddy_kong' => 1279,
      'donkey_kong' => 1280,
      'dr_mario' => 1282,
      'duck_hunt' => 1283,
      'falco' => 1285,
      'fox' => 1286,
      'ganondorf' => 1287,
      'greninja' => 1289,
      'ice_climbers' => 1290,
      'ike' => 1291,
      'inkling' => 1292,
      'jigglypuff' => 1293,
      'king_dedede' => 1294,
      'kirby' => 1295,
      'link' => 1296,
      'little_mac' => 1297,
      'lucario' => 1298,
      'lucas' => 1299,
      'lucina' => 1300,
      'luigi' => 1301,
      'mario' => 1302,
      'marth' => 1304,
      'mega_man' => 1305,
      'meta_knight' => 1307,
      'mewtwo' => 1310,
      'mii_brawler' => 1311,
      'ness' => 1313,
      'olimar' => 1314,
      'pac_man' => 1315,
      'palutena' => 1316,
      'peach' => 1317,
      'pichu' => 1318,
      'pikachu' => 1319,
      'pit' => 1320,
      'pokemon_trainer' => 1321,
      'ridley' => 1322,
      'rob' => 1323,
      'robin' => 1324,
      'rosalina_and_luma' => 1325,
      'roy' => 1326,
      'ryu' => 1327,
      'samus' => 1328,
      'sheik' => 1329,
      'shulk' => 1330,
      'snake' => 1331,
      'sonic' => 1332,
      'toon_link' => 1333,
      'villager' => 1334,
      'wario' => 1335,
      'wii_fit_trainer' => 1336,
      'wolf' => 1337,
      'yoshi' => 1338,
      'young_link' => 1339,
      'zelda' => 1340,
      'zero_suit_samus' => 1341,
      'mr_game_and_watch' => 1405,
      'incineroar' => 1406,
      'gaogaen' => 1406,
      'king_k_rool' => 1407,
      'dark_samus' => 1408,
      'chrom' => 1409,
      'ken' => 1410,
      'simon' => 1411,
      'richter' => 1412,
      'isabelle' => 1413,
      'mii_swordfighter' => 1414,
      'mii_gunner' => 1415,
      'piranha_plant' => 1441,
      'packun_flower' => 1441,
      'joker' => 1453,
      'hero' => 1526,
      'dq_hero' => 1526,
      'banjo_kazooie' => 1530,
      'banjo_and_kazooie' => 1530,
      'terry' => 1532,
      'byleth' => 1539,
      'min_min' => 1747,
      'minmin' => 1747,
      'steve' => 1766,
      'sephiroth' => 1777,
      'pyra_mythra' => 1795,
      'pyra_and_mythra' => 1795,
      'homura' => 1795,
      'kazuya' => 1846,
      'sora' => 1897,
      // aliases used in frontend
      'mii_fighter' => 1311,
    ];
  }

  /**
   * ID de personaje de start.gg → slug que coincide con el nombre del archivo de
   * icono del frontend (frontend/public/stock_icons/<slug>.png).
   */
  private function characterSlugFromStartggId($id): ?string
  {
    if ($id === null || $id === '') {
      return null;
    }
    $id = (int) $id;

    // Overrides para ids con varios slugs, eligiendo el que tiene icono en el front.
    $iconOverrides = [
      1311 => 'mii_brawler',
      1406 => 'incineroar',
      1441 => 'piranha_plant',
      1526 => 'hero',
      1530 => 'banjo_and_kazooie',
      1747 => 'minmin',
      1795 => 'pyra_and_mythra',
    ];
    if (isset($iconOverrides[$id])) {
      return $iconOverrides[$id];
    }

    // Para el resto, el primer slug encontrado coincide con el icono.
    foreach ($this->characterMap() as $slug => $charId) {
      if ((int) $charId === $id) {
        return $slug;
      }
    }
    return null;
  }

  /**
   * Obtener detalle de un set
   */
  public function getSetDetail(User $user, $setId): array
  {
    $query = <<<'GQL'
        query SetDetail($setId: ID!) {
          set(id: $setId) {
            id
            fullRoundText
            round
            identifier
            state
            event {
              id
              name
            }
            slots {
              id
              entrant {
                id
                name
                participants {
                  id
                  user {
                    id
                    name
                  }
                }
              }
            }
            phaseGroup {
              id
            }
          }
        }
        GQL;

    $data = $this->query($user, $query, ['setId' => $setId]);
    $set = data_get($data, 'set');

    if (!$set) {
      Log::error('Error fetching set detail', ['set_id' => $setId, 'error' => 'Set not found']);
      throw new RuntimeException('Set not found');
    }

    $slots = $set['slots'] ?? [];
    $p1 = $slots[0] ?? null;
    $p2 = $slots[1] ?? null;

    $bestOf = 3; // Default bestOf for Ultimate

    $status = match ($set['state'] ?? 0) {
      1 => 'not_started',
      2 => 'in_progress',
      3 => 'completed',
      default => 'not_started',
    };

    return [
      'id' => $set['id'],
      'eventId' => data_get($set, 'event.id'),
      'eventName' => data_get($set, 'event.name', 'Unknown Event'),
      'round' => $set['fullRoundText'] ?? 'Round ' . $set['round'],
      'bestOf' => $bestOf,
      'p1' => [
        'userId' => data_get($p1, 'entrant.participants.0.user.id'),
        'entrantId' => data_get($p1, 'entrant.id'),
        'name' => data_get($p1, 'entrant.name', 'TBD'),
      ],
      'p2' => [
        'userId' => data_get($p2, 'entrant.participants.0.user.id'),
        'entrantId' => data_get($p2, 'entrant.id'),
        'name' => data_get($p2, 'entrant.name', 'TBD'),
      ],
      'status' => $status,
      'stagesAvailable' => [
        'Battlefield',
        'Small Battlefield',
        'Final Destination',
        'Smashville',
        'Pokemon Stadium 2',
        'Town and City',
        "Yoshi's Story",
        'Hollow Bastion',
        'Kalos Pokemon League',
      ],
      'stagesBanned' => [],
      'currentTurn' => 'rps',
      'games' => [],
      'rpsWinner' => null,
    ];
  }

  /**
   * Marcar un set como en progreso
   */
  public function markSetInProgress(User $user, $setId): array
  {
    $mutation = <<<'GQL'
        mutation MarkSetInProgress($setId: ID!) {
          markSetInProgress(setId: $setId) {
            id
            state
          }
        }
        GQL;

    // Ejecutar la mutación
    $data = $this->query($user, $mutation, [
      'setId' => $setId,
    ]);

    $result = data_get($data, 'markSetInProgress');

    // Si la API devolvió errores o no hay resultado, obtener la respuesta cruda
    // y lanzar excepción con mensaje claro para que el controller lo maneje.
    if (empty($result)) {
      $raw = $this->debugQuery($user, $mutation, [
        'setId' => $setId,
      ]);

      $errMsg = 'Unknown error';
      if (!empty($raw['json']) && !empty($raw['json']['errors'])) {
        $err = $raw['json']['errors'][0] ?? null;
        $errMsg = $err['message'] ?? json_encode($raw['json']['errors']);
        Log::warning('startgg markSetInProgress errors', [
          'set_id' => $setId,
          'errors' => $raw['json']['errors'],
        ]);
      } else {
        Log::warning('startgg markSetInProgress empty result', ['set_id' => $setId, 'raw' => $raw]);
      }

      throw new RuntimeException('Failed to mark set in progress: ' . $errMsg);
    }

    return is_array($result) ? $result : (array) $result;
  }

  /**
   * Reiniciar un set en start.gg (vuelve al estado inicial / not_started).
   * Permite que un admin re-inicie el set y re-especifique el Best Of.
   */
  public function resetSet(User $user, $setId): array
  {
    $mutation = <<<'GQL'
        mutation ResetSet($setId: ID!) {
          resetSet(setId: $setId) {
            id
            state
          }
        }
        GQL;

    $data = $this->query($user, $mutation, ['setId' => $setId]);
    $result = data_get($data, 'resetSet');

    if (empty($result)) {
      $raw = $this->debugQuery($user, $mutation, ['setId' => $setId]);

      $errMsg = 'Unknown error';
      if (!empty($raw['json']['errors'])) {
        $err = $raw['json']['errors'][0] ?? null;
        $errMsg = $err['message'] ?? json_encode($raw['json']['errors']);
        Log::warning('startgg resetSet errors', [
          'set_id' => $setId,
          'errors' => $raw['json']['errors'],
        ]);
      } else {
        Log::warning('startgg resetSet empty result', ['set_id' => $setId, 'raw' => $raw]);
      }

      throw new RuntimeException('Failed to reset set: ' . $errMsg);
    }

    return is_array($result) ? $result : (array) $result;
  }

  /**
   * Reportar resultado de un set
   */
  public function reportSet(User $user, $setId, $winnerId, Report $report): array
  {
    $mutation = <<<'GQL'
        mutation ReportBracketSet($setId: ID!, $winnerId: ID!, $gameData: [BracketSetGameDataInput]) {
          reportBracketSet(
            setId: $setId
            winnerId: $winnerId
            gameData: $gameData
          ) {
            id
            state
          }
        }
        GQL;

    // Preparar gameData con cada juego reportado para evitar sets 1-0
    $gameData = [];

    // Catálogos mínimos (se pueden ampliar) para mapear a IDs de start.gg
    $stageMap = [
      'Battlefield' => 311,
      'Small Battlefield' => 484,
      'Final Destination' => 328,
      'Smashville' => 387,
      'Pokemon Stadium 2' => 378,
      'Town and City' => 397,
      "Yoshi's Story" => 407,
      'Hollow Bastion' => 513,
      'Kalos Pokemon League' => 348, // start.gg usa "Kalos Pokémon League"
    ];

    $characterMap = $this->characterMap();

    $mapStageId = function (?string $stageName) use ($stageMap) {
      return $stageName && array_key_exists($stageName, $stageMap)
        ? $stageMap[$stageName]
        : null;
    };

    $mapCharId = function (?string $charSlug) use ($characterMap) {
      if (!$charSlug)
        return null;
      $key = strtolower($charSlug);
      return $characterMap[$key] ?? null;
    };

    // Priorizar juegos guardados en la base de datos
    if ($report->relationLoaded('games') || $report->games()->exists()) {
      $games = $report->games()->orderBy('game_index')->get();
      foreach ($games as $game) {
        $entry = [
          'winnerId' => $game->winner === 'p1' ? $report->p1_entrant_id : $report->p2_entrant_id,
          'gameNum' => $game->game_index,
          'stageId' => $mapStageId($game->stage),
          'selections' => array_values(array_filter([
            $mapCharId($game->character_p1) ? [
              'entrantId' => $report->p1_entrant_id,
              'characterId' => $mapCharId($game->character_p1),
            ] : null,
            $mapCharId($game->character_p2) ? [
              'entrantId' => $report->p2_entrant_id,
              'characterId' => $mapCharId($game->character_p2),
            ] : null,
          ])),
        ];

        // Stocks opcionales: si alguno es desconocido (null), no enviamos scores a start.gg
        if ($game->stocks_p1 !== null && $game->stocks_p2 !== null) {
          $entry['entrant1Score'] = $game->stocks_p1;
          $entry['entrant2Score'] = $game->stocks_p2;
        }

        $gameData[] = $entry;
      }
    }

    // Fallback: construir gameData en base al marcador agregado si no hay games
    if (empty($gameData)) {
      $p1Wins = (int) $report->score_p1;
      $p2Wins = (int) $report->score_p2;
      $totalGames = max($p1Wins + $p2Wins, 1);
      $gameNum = 1;
      for ($i = 0; $i < $p1Wins; $i++) {
        $gameData[] = [
          'winnerId' => $report->p1_entrant_id,
          'gameNum' => $gameNum++,
        ];
      }
      for ($i = 0; $i < $p2Wins; $i++) {
        $gameData[] = [
          'winnerId' => $report->p2_entrant_id,
          'gameNum' => $gameNum++,
        ];
      }

      // Si aún no hay datos, registrar al menos un juego con el ganador global
      if (empty($gameData)) {
        $gameData[] = [
          'winnerId' => $winnerId,
          'gameNum' => 1,
        ];
      }
    }

    try {
      $data = $this->query($user, $mutation, [
        'setId' => $setId,
        'winnerId' => $winnerId,
        'gameData' => $gameData,
      ]);

      $result = data_get($data, 'reportBracketSet');

      if (empty($result)) {
        // Si no hay resultado, intentar obtener errores
        $raw = $this->debugQuery($user, $mutation, [
          'setId' => $setId,
          'winnerId' => $winnerId,
          'gameData' => $gameData,
        ]);

        $errMsg = 'Unknown error';
        if (!empty($raw['json']) && !empty($raw['json']['errors'])) {
          $err = $raw['json']['errors'][0] ?? null;
          $errMsg = $err['message'] ?? json_encode($raw['json']['errors']);
          Log::warning('startgg reportBracketSet errors', [
            'set_id' => $setId,
            'errors' => $raw['json']['errors'],
          ]);
        }

        throw new RuntimeException('Failed to report set: ' . $errMsg);
      }

      return is_array($result) ? $result : (array) $result;
    } catch (RuntimeException $e) {
      // Re-lanzar con el mensaje original
      throw $e;
    } catch (\Throwable $e) {
      // Mantener el mensaje original
      throw new RuntimeException($e->getMessage(), 0, $e);
    }
  }
}

