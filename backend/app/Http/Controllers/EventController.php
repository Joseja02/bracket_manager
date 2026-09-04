<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Services\StartggClient;
use App\Services\StartggAppClient;
use App\Models\Report;
use App\Models\SetState;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class EventController extends Controller
{
    use \App\Http\Concerns\ChecksEventAdmin;
    use \App\Http\Concerns\TracksSetEventBindings;

    public function __construct(
        private StartggClient $client,
        private StartggAppClient $appClient,
    ) {}

    /**
     * Obtener los sets de un evento
     * GET /api/events/{eventId}/sets
     *
     * El estado de cada set (not_started / in_progress, IDs, jugadores) sale
     * siempre de start.gg. SetState solo aporta Best Of local.
     */
    public function getSets(Request $request, $eventId)
    {
        $user = Auth::user();
        
        $mine = $request->boolean('mine');
        $statusFilter = $request->query('status');
        
        try {
            $sets = $this->client->getEventSets($user, $eventId, [
                'mine' => $mine,
                'status' => $statusFilter,
            ]);
            $this->rememberSetEventBindings($sets, $eventId);

            return response()->json($this->enrichDashboardSets($sets, $user, $mine, $statusFilter));
        } catch (\Throwable $e) {
            Log::error('Error fetching event sets', [
                'event_id' => $eventId,
                'error' => $e->getMessage(),
            ]);
            
            return response()->json([
                'error' => 'Failed to fetch event sets',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    private function enrichDashboardSets(array $sets, $user, bool $mine, ?string $statusFilter): array
    {
        $setIds = array_column($sets, 'id');
        $reports = Report::whereIn('set_id', $setIds)
            ->orderBy('created_at', 'desc')
            ->get()
            ->groupBy('set_id');
        $states = SetState::whereIn('set_id', $setIds)
            ->get()
            ->keyBy('set_id');

        $startggUserId = $user?->startgg_user_id;

        $mapped = array_map(function (array $set) use ($reports, $states, $mine, $startggUserId) {
            $report = $reports[$set['id']][0] ?? $reports[(string) $set['id']][0] ?? null;
            $state = $states->get($set['id']) ?? $states->get((string) $set['id']);
            if ($state?->best_of) {
                $set['bestOf'] = (int) $state->best_of;
            }

            // start.gg es la fuente de verdad: si el set vuelve a estar sin
            // iniciar, un reporte local antiguo no debe ocultarlo.
            if (($set['status'] ?? null) === 'not_started') {
                return $set;
            }

            if ($report) {
                $set['reportStatus'] = $report->status;
            }

            if (in_array($set['reportStatus'] ?? null, ['pending', 'approved'], true)) {
                return null;
            }

            if ($mine && $startggUserId) {
                $hasUserIds = ($set['p1']['userId'] ?? null) || ($set['p2']['userId'] ?? null);
                if ($hasUserIds) {
                    $isMine = (string) ($set['p1']['userId'] ?? '') === (string) $startggUserId
                        || (string) ($set['p2']['userId'] ?? '') === (string) $startggUserId;
                    if (!$isMine) {
                        return null;
                    }
                }
            }

            return $set;
        }, $sets);

        $filteredSets = array_values(array_filter($mapped));
        $filteredSets = array_values(array_filter($filteredSets, function ($set) {
            return in_array($set['status'] ?? null, ['not_started', 'in_progress'], true);
        }));

        if ($statusFilter) {
            $filteredSets = array_values(array_filter($filteredSets, function ($set) use ($statusFilter) {
                return $set['status'] === $statusFilter;
            }));
        }

        return $filteredSets;
    }

    /**
     * Obtener detalles de un evento
     * GET /api/events/{eventId}
     */
    public function show(Request $request, $eventId)
    {
        $user = Auth::user();

        // La respuesta incluye isAdmin calculado para ESTE usuario,
        // por lo que la cache debe ser por usuario.
        $cacheKey = "event_{$eventId}_detail_user_{$user->id}";
        
        try {
            $event = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user, $eventId) {
                return $this->client->getEvent($user, $eventId);
            });

            return response()->json($event);
        } catch (\Throwable $e) {
            Log::error('Error fetching event', [
                'event_id' => $eventId,
                'error' => $e->getMessage(),
            ]);
            
            return response()->json([
                'error' => 'Failed to fetch event',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Verificar si el usuario actual es admin del torneo del evento
     * GET /api/events/{eventId}/admin-check
     */
    public function adminCheck(Request $request, $eventId)
    {
        $user = Auth::user();
        /** @var \App\Models\User $user */

        if (!$user?->startgg_user_id) {
            return response()->json(['isAdmin' => false, 'reason' => 'missing_startgg_user_id']);
        }

        $startggUserId = (string) $user->startgg_user_id;
        $promoted = false;

        // Cache del resultado por usuario+evento para evitar 3 llamadas a
        // start.gg en cada recarga. Es lo que provocaba la lentitud al cargar
        // los sets (las peticiones se serializan en el server de desarrollo).
        $resultCacheKey = "event_admincheck_{$eventId}_user_{$user->id}";
        $cachedResult = Cache::get($resultCacheKey);
        if (is_array($cachedResult) && array_key_exists('isAdmin', $cachedResult)) {
            return response()->json([
                'isAdmin' => $cachedResult['isAdmin'],
                'slug' => $cachedResult['slug'] ?? null,
                'promoted' => false,
                'cached' => true,
            ]);
        }

        // Resolver slug SIEMPRE desde el evento (no confiar en el cliente).
        // Si el frontend envía tournamentSlug, solo se acepta si coincide.
        try {
            $cacheKey = "event_{$eventId}_detail_user_{$user->id}";
            $event = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user, $eventId) {
                return $this->client->getEvent($user, $eventId);
            });
            $slug = data_get($event, 'tournamentSlug') ?? data_get($event, 'tournamentName');
        } catch (\Throwable $e) {
            Log::error('adminCheck: failed to resolve slug from event', [
                'event_id' => $eventId,
                'error' => $e->getMessage(),
            ]);
            return response()->json(['isAdmin' => false, 'reason' => 'slug_unavailable'], 500);
        }

        if (!$slug) {
            return response()->json(['isAdmin' => false, 'reason' => 'slug_missing'], 400);
        }

        $clientSlug = $request->query('tournamentSlug');
        if ($clientSlug) {
            $normalize = static function (?string $value): string {
                $value = strtolower(trim((string) $value));
                return preg_replace('#^tournament/#', '', $value) ?? $value;
            };
            if ($normalize($clientSlug) !== $normalize($slug)) {
                Log::warning('adminCheck: tournament slug mismatch', [
                    'event_id' => $eventId,
                    'resolved_slug' => $slug,
                    'client_slug' => $clientSlug,
                    'user_id' => $user->id,
                ]);
                return response()->json([
                    'isAdmin' => false,
                    'reason' => 'tournament_mismatch',
                    'code' => 'tournament_mismatch',
                ], 409);
            }
        }

        $matchAdmin = function ($ownerId, array $adminIds) use ($startggUserId) {
            if (\App\Services\StartggClient::sameStartggUserId($ownerId, $startggUserId)) {
                return true;
            }
            return collect($adminIds)->contains(
                fn ($id) => \App\Services\StartggClient::sameStartggUserId($id, $startggUserId)
            );
        };

        // 1) Intentar con el token de la app (PAT)
        $appInfo = $this->appClient->getTournamentAdminInfo($slug);
        $ownerIdApp = $appInfo['ownerId'] ?? null;
        $adminIdsApp = collect($appInfo['adminUserIds'] ?? [])
            ->map(fn ($id) => (string) $id)
            ->filter()
            ->values()
            ->all();

        // Fallback: if no userIds were provided, map from admins array (id or user.id)
        if (count($adminIdsApp) === 0) {
            $adminIdsApp = collect($appInfo['admins'] ?? [])
            ->map(function ($admin) {
                return (string) (data_get($admin, 'id') ?? data_get($admin, 'user.id'));
            })
            ->filter()
            ->values()
            ->all();
        }

        $isAdmin = $matchAdmin($ownerIdApp, $adminIdsApp);

        // 2) Consultar el evento con token de usuario (sin cache) para usar event.isAdmin
        $ownerIdViaUser = null;
        $adminIdsViaUser = [];
        $isAdminViaFlag = false;
        if (!$isAdmin) {
            try {
                $eventDetail = $this->client->getEvent($user, $eventId);
                if (!empty($eventDetail['isAdminEvent'])) {
                    $isAdmin = true;
                }
                // guardar owner del torneo para logging
                $ownerIdViaUser = data_get($eventDetail, 'tournamentOwner');
            } catch (\Throwable $e) {
                Log::warning('adminCheck fallback event isAdmin failed', [
                    'event_id' => $eventId,
                    'slug' => $slug,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // 3) Fallback adicional: usar el token OAuth del usuario para obtener owner + admins delegados
        if (!$isAdmin) {
            try {
                $userAdminInfo = $this->client->getTournamentAdminInfo($user, $slug);
                $ownerIdViaUser = $ownerIdViaUser ?? ($userAdminInfo['ownerId'] ?? null);
                $adminIdsViaUser = $userAdminInfo['adminIds'] ?? [];
                $isAdminViaFlag = (bool) ($userAdminInfo['isAdmin'] ?? false);
                $isAdmin = $matchAdmin($ownerIdViaUser, $adminIdsViaUser);
                if (!$isAdmin && $isAdminViaFlag) {
                    $isAdmin = true; // current user flagged as admin by API
                }
            } catch (\Throwable $e) {
                Log::warning('adminCheck fallback admins via user token failed', [
                    'event_id' => $eventId,
                    'slug' => $slug,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        if ($isAdmin && $user->role !== 'admin') {
            $user->role = 'admin';
            $user->save();
            $promoted = true;
            Log::info('adminCheck: user promoted to admin role', [
                'user_id' => $user->id,
                'startgg_user_id' => $startggUserId,
                'event_id' => $eventId,
                'slug' => $slug,
            ]);
        }

        Log::info('adminCheck result', [
            'event_id' => $eventId,
            'slug' => $slug,
            'user_id' => $user->id,
            'startgg_user_id' => $user->startgg_user_id,
            'is_admin' => $isAdmin,
            'owner_app' => $ownerIdApp,
            'admins_app_count' => count($adminIdsApp),
            'owner_via_user' => $ownerIdViaUser,
            'admins_user_count' => count($adminIdsViaUser),
            'is_admin_via_flag' => $isAdminViaFlag,
            'promoted' => $promoted,
        ]);

        // Guardar resultado en cache 5 min para acelerar recargas posteriores
        Cache::put($resultCacheKey, [
            'isAdmin' => $isAdmin,
            'slug' => $slug,
        ], now()->addMinutes(5));
        Cache::put("event_isadmin_{$eventId}_user_{$user->id}", $isAdmin, now()->addMinutes(5));

        return response()->json([
            'isAdmin' => $isAdmin,
            'slug' => $slug,
            'promoted' => $promoted,
        ]);
    }
}

