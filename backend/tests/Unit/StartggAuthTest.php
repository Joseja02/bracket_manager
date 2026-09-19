<?php

namespace Tests\Unit;

use App\Models\User;
use App\Services\StartggAuth;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class StartggAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_refresh_returns_null_without_refresh_token(): void
    {
        Http::fake();
        $user = User::factory()->create([
            'startgg_refresh_token' => null,
            'startgg_access_token' => 'access',
        ]);

        $auth = new StartggAuth();
        $this->assertNull($auth->refresh($user));
        Http::assertNothingSent();
    }

    public function test_refresh_updates_tokens_and_expiry(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-01-01 12:00:00'));
        Http::fake([
            'https://api.start.gg/oauth/access_token' => Http::response([
                'access_token' => 'new-access',
                'refresh_token' => 'new-refresh',
                'expires_in' => 3600,
            ], 200),
        ]);

        $user = User::factory()->create([
            'startgg_refresh_token' => 'old-refresh',
            'startgg_access_token' => 'old-access',
        ]);

        $auth = new StartggAuth();
        $token = $auth->refresh($user);

        $this->assertSame('new-access', $token);
        $this->assertSame('new-access', $user->fresh()->startgg_access_token);
        $this->assertSame('new-refresh', $user->fresh()->startgg_refresh_token);
        $this->assertTrue($user->fresh()->token_expires_at->equalTo(Carbon::now()->addSeconds(3600)));
    }

    public function test_refresh_returns_null_on_failure(): void
    {
        Http::fake([
            'https://api.start.gg/oauth/access_token' => Http::response(['error' => 'invalid'], 400),
        ]);

        $user = User::factory()->create([
            'startgg_refresh_token' => 'refresh',
            'startgg_access_token' => 'access',
        ]);

        $auth = new StartggAuth();
        $this->assertNull($auth->refresh($user));
        $this->assertSame('access', $user->fresh()->startgg_access_token);
    }

    public function test_get_valid_token_returns_null_when_expired_and_refresh_fails(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-01-01 12:00:00'));
        Http::fake([
            'https://api.start.gg/oauth/access_token' => Http::response(['error' => 'invalid'], 400),
        ]);

        $user = User::factory()->create([
            'startgg_refresh_token' => 'refresh',
            'startgg_access_token' => 'expired-access',
            'token_expires_at' => Carbon::now()->subMinute(),
        ]);

        $auth = new StartggAuth();
        $this->assertNull($auth->getValidToken($user, 5));
        $this->assertSame('expired-access', $user->fresh()->startgg_access_token);
        Http::assertSentCount(1);
    }

    public function test_get_valid_token_keeps_current_token_when_it_is_still_valid(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-01-01 12:00:00'));
        $user = User::factory()->create([
            'startgg_refresh_token' => 'refresh',
            'startgg_access_token' => 'still-valid',
            'token_expires_at' => Carbon::now()->addMinutes(30),
        ]);

        $auth = new StartggAuth();
        $this->assertSame('still-valid', $auth->getValidToken($user, 5));
        Http::assertNothingSent();
    }
}

