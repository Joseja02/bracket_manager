<?php

namespace App\Http\Concerns;

use App\Services\StartggClient;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Verificación reutilizable de si un usuario es admin (owner o rol delegado:
 * Administrator/Manager/Bracket Manager/Reporter) del torneo de un evento.
 *
 * Requiere que la clase disponga de:
 *   - $this->client     (App\Services\StartggClient)
 *   - $this->appClient  (App\Services\StartggAppClient)
 */
trait ChecksEventAdmin
{
    protected function isEventAdmin($user, $eventId): bool
    {
        if (!$user?->startgg_user_id) {
            return false;
        }

        $startggUserId = (string) $user->startgg_user_id;

        // Cache corta por usuario+evento: evita repetir 2-3 llamadas a start.gg
        // en acciones consecutivas (aprobar varios reportes, iniciar sets, etc.).
        $cacheKey = "event_isadmin_{$eventId}_user_{$user->id}";
        $cached = Cache::get($cacheKey);
        if (is_bool($cached)) {
            return $cached;
        }

        // La página del evento ya resolvió admin-check; no repetir GraphQL al iniciar sets.
        $adminCheck = Cache::get("event_admincheck_{$eventId}_user_{$user->id}");
        if (is_array($adminCheck) && array_key_exists('isAdmin', $adminCheck)) {
            $result = (bool) $adminCheck['isAdmin'];
            Cache::put($cacheKey, $result, $result ? now()->addMinutes(5) : now()->addSeconds(20));
            return $result;
        }

        $result = $this->resolveEventAdmin($user, $eventId, $startggUserId);

        // Solo cacheamos el positivo de forma más larga; el negativo se cachea
        // muy poco para que un admin recién añadido no quede bloqueado.
        Cache::put($cacheKey, $result, $result ? now()->addMinutes(5) : now()->addSeconds(20));

        return $result;
    }

    private function resolveEventAdmin($user, $eventId, string $startggUserId): bool
    {
        try {
            $event = $this->client->getEvent($user, $eventId);

            // Owner del torneo
            if (!empty($event['isAdminEvent'])) {
                return true;
            }

            // Nunca usar tournamentName como slug: rompe la lookup de admins.
            $slug = data_get($event, 'tournamentSlug');
            if (!$slug) {
                Log::warning('event admin check: missing tournamentSlug', [
                    'event_id' => $eventId,
                    'user_id' => $user->id ?? null,
                ]);
                return false;
            }

            $matches = function (?string $ownerId, array $adminIds) use ($startggUserId): bool {
                if (StartggClient::sameStartggUserId($ownerId, $startggUserId)) {
                    return true;
                }
                return collect($adminIds)->contains(
                    fn ($id) => StartggClient::sameStartggUserId($id, $startggUserId)
                );
            };

            // Fuente 1: token de app (solo si STARTGG_APP_TOKEN está configurado)
            $appInfo = $this->appClient->getTournamentAdminInfo($slug);
            if ($matches($appInfo['ownerId'] ?? null, $appInfo['adminUserIds'] ?? [])) {
                return true;
            }

            // Fuente 2: token OAuth del propio usuario (detecta todos los roles y
            // no depende del APP_TOKEN; funciona por la "admin-only view" de start.gg)
            $userInfo = $this->client->getTournamentAdminInfo($user, $slug);
            if (!empty($userInfo['isAdmin'])) {
                return true;
            }

            return $matches($userInfo['ownerId'] ?? null, $userInfo['adminIds'] ?? []);
        } catch (\Throwable $e) {
            Log::warning('event admin check failed', [
                'event_id' => $eventId,
                'user_id' => $user->id ?? null,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }
}
