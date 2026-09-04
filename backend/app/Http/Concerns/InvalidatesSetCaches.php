<?php

namespace App\Http\Concerns;

use Illuminate\Support\Facades\Cache;

/**
 * Invalidación de caches de detalle/spectate (no de la lista de sets:
 * esa lista se lee siempre de start.gg).
 */
trait InvalidatesSetCaches
{
    protected function invalidateSetCaches(
        string|int $setId,
        string|int|null $eventId = null,
        string|int|null $userId = null,
        bool $forgetAdminCaches = true,
    ): void {
        Cache::forget("set_detail_{$setId}");
        Cache::forget("set_spectate_{$setId}");
        Cache::forget("set_spectate_meta_{$setId}");

        if ($forgetAdminCaches && $eventId !== null && $userId !== null) {
            Cache::forget("event_isadmin_{$eventId}_user_{$userId}");
            Cache::forget("event_admincheck_{$eventId}_user_{$userId}");
            Cache::forget("event_{$eventId}_detail_user_{$userId}");
        }
    }
}
