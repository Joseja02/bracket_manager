<?php

namespace App\Http\Concerns;

use Illuminate\Support\Facades\Cache;

/**
 * Guarda brevemente relaciones set -> evento observadas directamente en
 * respuestas live de start.gg. No cachea listas ni modifica el estado mostrado.
 */
trait TracksSetEventBindings
{
    protected function rememberSetEventBindings(array $sets, string|int $eventId): void
    {
        foreach ($sets as $set) {
            if (!isset($set['id'])) {
                continue;
            }

            Cache::put($this->setEventBindingKey($set['id']), [
                'eventId' => (string) ($set['eventId'] ?? $eventId),
                'status' => $set['status'] ?? null,
            ], now()->addMinutes(3));
        }
    }

    protected function getSetEventBinding(string|int $setId): ?array
    {
        $binding = Cache::get($this->setEventBindingKey($setId));

        return is_array($binding) && isset($binding['eventId']) ? $binding : null;
    }

    protected function forgetSetEventBinding(string|int $setId): void
    {
        Cache::forget($this->setEventBindingKey($setId));
    }

    private function setEventBindingKey(string|int $setId): string
    {
        return 'set_event_binding_' . hash('sha256', (string) $setId);
    }
}
