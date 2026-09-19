<?php

namespace App\Services;

use Illuminate\Http\JsonResponse;

/**
 * Clasifica mensajes de error de start.gg GraphQL / HTTP en códigos estables
 * para respuestas API consistentes en el frontend.
 */
class StartggErrorClassifier
{
    public const MISSING_SCOPE = 'missing_scope';
    public const INVALID_TOKEN = 'invalid_token';
    public const ACCESS_DENIED = 'access_denied';
    public const TOURNAMENT_MISMATCH = 'tournament_mismatch';
    public const UNKNOWN = 'unknown';

    public static function classify(string $message): string
    {
        $m = strtolower($message);

        if (
            str_contains($m, 'missing the following scopes')
            || str_contains($m, 'tournament.reporter')
            || str_contains($m, 'insufficient scopes')
            || (str_contains($m, 'scope') && !str_contains($m, 'telescope'))
        ) {
            return self::MISSING_SCOPE;
        }

        if (
            str_contains($m, 'no valid access token')
            || str_contains($m, 'please re-authenticate')
            || str_contains($m, 'invalid token')
            || str_contains($m, 'token expired')
            || str_contains($m, 'expired token')
            || str_contains($m, 'unauthenticated')
        ) {
            return self::INVALID_TOKEN;
        }

        if (
            str_contains($m, 'tournament mismatch')
            || str_contains($m, 'wrong tournament')
            || str_contains($m, 'does not belong')
            || (str_contains($m, 'tournament') && str_contains($m, 'mismatch'))
        ) {
            return self::TOURNAMENT_MISMATCH;
        }

        if (
            str_contains($m, 'access denied')
            || str_contains($m, 'forbidden')
            || str_contains($m, 'not authorized')
            || str_contains($m, 'unauthorized')
            || str_contains($m, 'permission denied')
        ) {
            return self::ACCESS_DENIED;
        }

        return self::UNKNOWN;
    }

    public static function httpStatus(string $code): int
    {
        return match ($code) {
            self::MISSING_SCOPE => 403,
            self::INVALID_TOKEN => 401,
            self::ACCESS_DENIED => 403,
            self::TOURNAMENT_MISMATCH => 409,
            default => 500,
        };
    }

    public static function toJsonResponse(string $message, string $fallbackError = 'Request failed'): JsonResponse
    {
        $code = self::classify($message);
        $payload = [
            'error' => $fallbackError,
            'message' => $message,
            'code' => $code,
        ];

        if ($code === self::MISSING_SCOPE) {
            $payload['error'] = 'Insufficient scopes';
            $payload['action'] = 'reauthenticate';
            $payload['reauth_url'] = self::reauthUrl();
            $payload['note'] = 'Authenticate again to grant the tournament.reporter scope';
        } elseif ($code === self::INVALID_TOKEN) {
            $payload['error'] = 'Invalid or expired token';
            $payload['action'] = 'reauthenticate';
            $payload['reauth_url'] = self::reauthUrl();
        }

        return response()->json($payload, self::httpStatus($code));
    }

    private static function reauthUrl(): string
    {
        return rtrim((string) config('app.url', env('APP_URL', 'http://localhost:8000')), '/') . '/auth/login';
    }
}
