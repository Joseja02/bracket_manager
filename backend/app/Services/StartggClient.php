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
        ->post(config('startgg.api_url_oauth'), [ // Usar endpoint OAuth
          'query' => $query,
          'variables' => (object) $variables,
        ]);
    };

    $resp = $doRequest($token);

    // Si aún así recibimos un 401, intentar refrescar una vez más (fallback)
    if ($resp->status() === 401) {
      Log::warning('startgg received 401 after proactive refresh, attempting emergency refresh', [
        'user_id' => $user->id,
      ]);
      $token = $this->auth->refresh($user) ?? $token;
      $resp = $doRequest($token);
    }

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
   * Obtener owner y admins de un torneo usando el token del usuario (OAuth)
   */
  public function getTournamentAdminInfo(User $user, string $slug): array
  {
    $normalized = ltrim(preg_replace('/^tournament\//', '', $slug) ?? '', '/');

    $query = <<<'GQL'
      query TournamentAdminsViaUser($slug: String!) {
        tournament(slug: $slug) {
        owner { id }
        admins { id }
        }
      }
      GQL;

    $slugsToTry = array_values(array_unique(array_filter([$normalized, $slug])));
    $ownerId = null;
    $adminIds = [];
    $isAdminFlag = false;

    foreach ($slugsToTry as $slugToUse) {
      $data = $this->query($user, $query, ['slug' => $slugToUse]);
      $ownerId = data_get($data, 'tournament.owner.id');
      $admins = data_get($data, 'tournament.admins', []);
      $adminIds = collect($admins)
        ->map(fn($admin) => (string) data_get($admin, 'id'))
        ->filter()
        ->values()
        ->all();

      Log::info('start.gg user admin lookup', [
        'slug' => $slugToUse,
        'owner_id' => $ownerId,
        'admin_count' => count($adminIds),
        'admins_sample' => array_slice($adminIds, 0, 3),
        'user_id' => $user->id,
        'is_admin_flag' => $isAdminFlag,
      ]);

      // Salir si obtuvimos datos
      if ($ownerId || !empty($adminIds) || $isAdminFlag) {
        break;
      }
    }

    return [
      'ownerId' => $ownerId,
      'adminIds' => $adminIds,
      'isAdmin' => $isAdminFlag ?? false,
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
                    name
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
            videogame {
              id
              name
            }
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
    $userId = (int) $user->startgg_user_id;

    // Solo el owner del torneo se considera admin aquí. Los admins delegados
    // se verifican en EventController::adminCheck (PAT de app + tournament.admins),
    // que es la fuente fiable. Antes se consideraba admin a cualquier usuario
    // inscrito en el torneo, lo que mostraba "Iniciar Set" a jugadores sin permisos.
    $isAdmin = $tournamentOwner == $userId;
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
   * Obtener sets de un evento
   */
  public function getEventSets(User $user, $eventId, array $filters = []): array
  {
    $query = <<<'GQL'
        query EventSets($eventId: ID!, $page: Int, $perPage: Int, $filters: SetFilters) {
          event(id: $eventId) {
            id
            name
            phases {
              id
              name
              sets(
                page: $page
                perPage: $perPage
                sortType: STANDARD
                filters: $filters
              ) {
                pageInfo {
                  total
                  totalPages
                }
                nodes {
                  id
                  fullRoundText
                  round
                  identifier
                  state
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
                }
              }
            }
          }
        }
        GQL;

    $data = $this->query($user, $query, [
      'eventId' => $eventId,
      'page' => 1,
      'perPage' => 50,
      'filters' => [
        // Incluir solo sets no empezados y en progreso (excluir completados)
        'state' => [1, 2], // 1=not_started, 2=in_progress
      ],
    ]);

    $phases = data_get($data, 'event.phases', []);
    $eventName = data_get($data, 'event.name', 'Unknown Event');

    // Combinar sets de todas las phases
    $allSets = [];
    foreach ($phases as $phase) {
      $phaseSets = data_get($phase, 'sets.nodes', []);
      $allSets = array_merge($allSets, $phaseSets);
    }

    Log::info('Raw sets from start.gg', [
      'event_id' => $eventId,
      'total_phases' => count($phases),
      'total_sets' => count($allSets),
      'first_set' => $allSets[0] ?? null,
    ]);

    $mapped = array_map(function ($set) use ($eventId, $eventName) {
      $slots = $set['slots'] ?? [];
      $p1 = $slots[0] ?? null;
      $p2 = $slots[1] ?? null;

      // Mapear estados de start.gg a nuestros estados
      $status = match ($set['state'] ?? 0) {
        1 => 'not_started',
        2 => 'in_progress',
        3 => 'completed',
        default => 'not_started',
      };

      // Obtener user ID del primer participante del entrant
      $p1UserId = data_get($p1, 'entrant.participants.0.user.id');
      $p2UserId = data_get($p2, 'entrant.participants.0.user.id');

      // Obtener nombres, null si no hay entrant
      $p1Name = data_get($p1, 'entrant.name');
      $p2Name = data_get($p2, 'entrant.name');

      return [
        'id' => $set['id'],
        'eventId' => $eventId,
        'eventName' => $eventName,
        'round' => $set['fullRoundText'] ?? 'Round ' . $set['round'],
        'bestOf' => 3, // TODO: obtener bestOf real del set
        'p1' => [
          'userId' => $p1UserId,
          'entrantId' => data_get($p1, 'entrant.id'),
          'name' => $p1Name ?? 'TBD',
        ],
        'p2' => [
          'userId' => $p2UserId,
          'entrantId' => data_get($p2, 'entrant.id'),
          'name' => $p2Name ?? 'TBD',
        ],
        'status' => $status,
      ];
    }, $allSets);

    // Filtrar sets que tengan ambos participantes asignados
    $filtered = array_values(array_filter($mapped, function ($set) {
      $hasP1 = $set['p1']['name'] !== 'TBD' && !empty($set['p1']['name']);
      $hasP2 = $set['p2']['name'] !== 'TBD' && !empty($set['p2']['name']);
      return $hasP1 && $hasP2;
    }));

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

    $characterMap = [
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

