<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Carbon\Carbon;

class StartggController extends Controller
{
    /**
     * Construye la URL completa del frontend (origen + path base)
     */
    private function getFrontendUrl(): string
    {
        $origin = env('FRONTEND_URL', 'https://joseja02.github.io');
        $basePath = env('FRONTEND_BASE_PATH', '/startgg_manager');
        return rtrim($origin, '/') . $basePath;
    }

    public function login(Request $request)
    {
        $state = Str::random(32);
        // Store state in session (primary) and also as a signed cookie (fallback/redundant)
        $request->session()->put('oauth_state', $state);
        // Also store in a dedicated cookie to bypass session storage issues
        Cookie::queue(Cookie::make('oauth_state_cookie', $state, 30, '/', null, true, true, false, 'None'));

        Log::info('oauth login initiated', [
            'state' => $state,
            'session_id' => $request->session()->getId(),
        ]);

        $params = http_build_query([
            'client_id' => config('startgg.client_id'),
            'redirect_uri' => config('startgg.redirect_uri'),
            'response_type' => 'code',
            // Añadimos el scope necesario para reportar/gestionar sets
            'scope' => 'user.identity user.email tournament.reporter',
            'state' => $state,
        ]);

        $authorizeUrl = rtrim(config('startgg.oauth_authorize_url'), '?') . '?' . $params;
        return redirect()->away($authorizeUrl);
    }

    public function callback(Request $request)
    {
        $frontendUrl = $this->getFrontendUrl();
        
        // Try to get state from session first (primary), then fallback to cookie (redundant for diagnosis)
        // Use get() instead of pull() to avoid removing it on first check
        $stateFromSession = $request->session()->get('oauth_state');
        $stateFromCookie = $request->cookie('oauth_state_cookie');
        $state = $stateFromSession ?? $stateFromCookie;
        
        $receivedState = $request->query('state');
        $code = $request->query('code');

        Log::info('oauth callback received', [
            'state_from_session_exists' => (bool) $stateFromSession,
            'state_from_cookie_exists' => (bool) $stateFromCookie,
            'received_state' => $receivedState,
            'session_id' => $request->session()->getId(),
            'session_cookie' => $request->cookie(config('session.cookie')),
            'has_code' => (bool) $code,
        ]);

        // Validate state first
        if (!$state || $state !== $receivedState) {
            // Log useful debugging info without exposing sensitive tokens
            Log::warning('oauth callback state mismatch', [
                'expected_state_exists' => (bool) $state,
                'expected_state_from_session' => (bool) $stateFromSession,
                'expected_state_from_cookie' => (bool) $stateFromCookie,
                'received_state' => $receivedState,
                'session_id' => $request->session()->getId(),
                'session_cookie' => $request->cookie(config('session.cookie')),
            ]);

            // Redirect to frontend with an error query param for better UX
            return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?error=invalid_state');
        }

        if (!$code) {
            Log::warning('oauth callback missing code', [
                'session_id' => $request->session()->getId(),
                'session_cookie' => $request->cookie(config('session.cookie')),
                'query' => $request->query(),
            ]);

            return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?error=missing_code');
        }

        // Prevent duplicate code usage: check if this code was already processed
        $codeCacheKey = 'oauth_code_used_' . hash('sha256', $code);
        if (Cache::has($codeCacheKey)) {
            Log::warning('oauth callback duplicate code usage', [
                'code_hash' => substr(hash('sha256', $code), 0, 8),
                'session_id' => $request->session()->getId(),
            ]);
            
            // If code was already used successfully, redirect to frontend with a message
            // Otherwise, it's a retry after failure - redirect with error
            return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?error=code_already_used');
        }

        // Mark code as being processed (expires in 5 minutes to prevent memory leaks)
        Cache::put($codeCacheKey, true, 300);

        // Remove state from session now that we've validated it
        $request->session()->forget('oauth_state');

        // Intercambiar authorization code por access token
        // Documentación: https://developer.start.gg/docs/oauth/oauth-overview
        $tokenUrl = config('startgg.oauth_token_url');
        
        $tokenResponse = Http::asForm()->post($tokenUrl, [
            'grant_type' => 'authorization_code',
            'client_id' => config('startgg.client_id'),
            'client_secret' => config('startgg.client_secret'),
            'code' => $code,
            'redirect_uri' => config('startgg.redirect_uri'),
        ]);

        if ($tokenResponse->failed()) {
            $errorBody = $tokenResponse->body();
            $isRevokedCode = str_contains($errorBody, 'revoked') || str_contains($errorBody, 'invalid');
            
            Log::error('startgg token error', [
                'status' => $tokenResponse->status(),
                'body' => $errorBody,
                'is_revoked_code' => $isRevokedCode,
            ]);
            
            // If code was revoked/already used, don't remove from cache (keep it marked as used)
            // Otherwise, remove from cache so it can be retried (though unlikely to succeed)
            if (!$isRevokedCode) {
                Cache::forget($codeCacheKey);
            }
            
            return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?error=token_exchange_failed');
        }

        $tokenData = $tokenResponse->json();
        $accessToken = $tokenData['access_token'] ?? null;
        $refreshToken = $tokenData['refresh_token'] ?? null;
        $expiresIn = $tokenData['expires_in'] ?? null;

        if (!$accessToken) {
            Log::error('startgg no access token', ['response' => $tokenData]);
            return response()->json(['error' => 'No access token received'], 500);
        }

        // Obtener usuario actual de start.gg via GraphQL
        $userQuery = <<<'GQL'
        query {
          currentUser {
            id
            email
            player {
              id
              gamerTag
              prefix
            }
          }
        }
        GQL;

        $graphqlEndpoint = config('startgg.api_url_oauth');

        $graphqlResponse = Http::withToken($accessToken)
            ->acceptJson()
            ->post($graphqlEndpoint, [
                'query' => $userQuery,
            ]);

        if ($graphqlResponse->failed()) {
            Log::error('startgg graphql user error', [
                'status' => $graphqlResponse->status(),
                'body' => $graphqlResponse->body(),
                'headers' => $graphqlResponse->headers(),
                'endpoint' => $graphqlEndpoint,
            ]);
            return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?error=graphql_failed');
        }

        $userData = data_get($graphqlResponse->json(), 'data.currentUser');

        // Persistir/actualizar usuario local con tokens de start.gg
        $startggUserId = data_get($userData, 'id');
        $email = data_get($userData, 'email');
        $gamerTag = data_get($userData, 'player.gamerTag');

        $existingUser = User::where('startgg_user_id', (string) $startggUserId)->first();
        $role = $existingUser?->role ?? 'competitor';

        $user = User::query()->updateOrCreate(
            ['startgg_user_id' => (string) $startggUserId],
            [
                'name' => $gamerTag ?: ('user_'.$startggUserId),
                'email' => $email ?: ('user_'.$startggUserId.'@startgg.local'),
                'password' => bcrypt(Str::random(32)), // Password aleatorio (no se usará, solo OAuth)
                'startgg_access_token' => $accessToken,
                'startgg_refresh_token' => $refreshToken,
                'token_expires_at' => $expiresIn ? Carbon::now()->addSeconds((int) $expiresIn) : null,
                'role' => $role,
            ]
        );

        // Crear token de API para el frontend
        $apiToken = $user->createToken('web-app')->plainTextToken;

        // Redirigir al frontend con el token
        $frontendUrl = $this->getFrontendUrl();
        
        return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?token=' . $apiToken);
    }

    /**
     * Login de desarrollo SOLO para localhost.
     *
     * start.gg permite un único redirect_uri por aplicación y lo ocupa producción,
     * por lo que en local no se puede completar el flujo OAuth. Este atajo inyecta
     * un Personal Access Token (PAT) preconfigurado y emite un token Sanctum, sin
     * pasar nunca por el callback de start.gg.
     *
     * SEGURIDAD (defensa en profundidad, 3 barreras):
     *   1. La ruta solo se registra cuando APP_ENV=local (ver routes/web.php). En
     *      dev/producción la ruta NO EXISTE.
     *   2. Este método vuelve a exigir entorno local + flag explícito DEV_AUTH_BYPASS.
     *   3. El PAT y el user id viven solo en backend/.env local (gitignored).
     */
    public function devLogin(Request $request)
    {
        if (!app()->environment('local') || !filter_var(env('DEV_AUTH_BYPASS', false), FILTER_VALIDATE_BOOLEAN)) {
            Log::warning('dev-login blocked: not local environment or flag disabled', [
                'environment' => app()->environment(),
            ]);
            abort(404);
        }

        $devUserId = env('STARTGG_DEV_USER_ID');
        $devToken = env('STARTGG_DEV_TOKEN');
        $devGamerTag = env('STARTGG_DEV_GAMERTAG', 'DevUser');

        if (!$devUserId || !$devToken) {
            Log::error('dev-login misconfigured: missing STARTGG_DEV_USER_ID or STARTGG_DEV_TOKEN');
            abort(500, 'Dev login no configurado. Define STARTGG_DEV_USER_ID y STARTGG_DEV_TOKEN en backend/.env');
        }

        // El PAT de start.gg no expira; ponemos una expiración lejana para que
        // StartggAuth::getValidToken no intente refrescarlo (no hay refresh token).
        $user = User::query()->updateOrCreate(
            ['startgg_user_id' => (string) $devUserId],
            [
                'name' => $devGamerTag,
                'email' => 'dev_' . $devUserId . '@startgg.local',
                'password' => bcrypt(Str::random(32)),
                'startgg_access_token' => $devToken,
                'startgg_refresh_token' => null,
                'token_expires_at' => Carbon::now()->addYears(5),
            ]
        );

        $apiToken = $user->createToken('dev-login')->plainTextToken;

        Log::info('dev-login issued local token', ['user_id' => $user->id]);

        $frontendUrl = $this->getFrontendUrl();
        return redirect()->away(rtrim($frontendUrl, '/') . '/oauth/callback?token=' . $apiToken);
    }
}
