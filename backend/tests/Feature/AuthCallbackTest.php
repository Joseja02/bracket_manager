<?php

namespace Tests\Feature;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AuthCallbackTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('FRONTEND_URL=http://localhost:8080');
        putenv('FRONTEND_BASE_PATH=');
        config()->set('startgg.client_id', 'client-id');
        config()->set('startgg.client_secret', 'client-secret');
        config()->set('startgg.redirect_uri', 'http://localhost/auth/callback');
        config()->set('startgg.oauth_token_url', 'https://api.start.gg/oauth/token');
        config()->set('startgg.api_url_oauth', 'https://api.start.gg/gql/alpha');
    }

    public function test_callback_exchanges_token_and_redirects_with_api_token(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-01-01 10:00:00'));

        Http::fake([
            'https://api.start.gg/oauth/token' => Http::response([
                'access_token' => 'access-123',
                'refresh_token' => 'refresh-123',
                'expires_in' => 3600,
            ], 200),
            'https://api.start.gg/gql/alpha' => Http::response([
                'data' => [
                    'currentUser' => [
                        'id' => '99',
                        'email' => 'user@example.com',
                        'player' => ['gamerTag' => 'Player99'],
                    ],
                ],
            ], 200),
        ]);

        $response = $this->withSession(['oauth_state' => 'state-123'])
            ->get('/auth/callback?code=code-123&state=state-123');

        $response->assertRedirect();
        $location = $response->headers->get('Location');

        $this->assertStringStartsWith('http://localhost:8080/oauth/callback?token=', $location);

        $user = User::where('startgg_user_id', '99')->first();
        $this->assertNotNull($user);
        $this->assertSame('Player99', $user->name);
        $this->assertSame('access-123', $user->startgg_access_token);
        $this->assertSame('refresh-123', $user->startgg_refresh_token);
    }

    public function test_callback_rejects_invalid_state(): void
    {
        $response = $this->withSession(['oauth_state' => 'state-a'])
            ->get('/auth/callback?code=code-123&state=state-b');

        $response->assertRedirect('http://localhost:8080/oauth/callback?error=invalid_state');
    }

    public function test_callback_requires_code(): void
    {
        $response = $this->withSession(['oauth_state' => 'state-a'])
            ->get('/auth/callback?state=state-a');

        $response->assertRedirect('http://localhost:8080/oauth/callback?error=missing_code');
    }
}

