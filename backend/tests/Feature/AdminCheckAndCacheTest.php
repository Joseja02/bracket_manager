<?php

namespace Tests\Feature;

use App\Models\Game;
use App\Models\Report;
use App\Models\User;
use App\Services\StartggAppClient;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminCheckAndCacheTest extends TestCase
{
    use RefreshDatabase;

    private function createPendingReport(User $user): Report
    {
        $report = Report::create([
            'user_id' => $user->id,
            'event_id' => 10,
            'event_name' => 'Event',
            'set_id' => 'set-1',
            'round' => 'Winners R1',
            'best_of' => 3,
            'p1_entrant_id' => 111,
            'p1_name' => 'Player 1',
            'p2_entrant_id' => 222,
            'p2_name' => 'Player 2',
            'score_p1' => 2,
            'score_p2' => 0,
            'status' => 'pending',
            'notes' => 'Notes',
        ]);

        Game::create([
            'report_id' => $report->id,
            'game_index' => 1,
            'stage' => 'Battlefield',
            'winner' => 'p1',
            'stocks_p1' => 2,
            'stocks_p2' => 0,
        ]);

        return $report;
    }

    public function test_admin_check_rejects_mismatched_tournament_slug(): void
    {
        $user = User::factory()->create([
            'role' => 'competitor',
            'startgg_user_id' => '55',
        ]);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'real-tournament',
                'isAdminEvent' => true,
            ]);
        });

        $this->getJson('/api/events/10/admin-check?tournamentSlug=other-tournament')
            ->assertStatus(409)
            ->assertJson([
                'isAdmin' => false,
                'reason' => 'tournament_mismatch',
                'code' => 'tournament_mismatch',
            ]);
    }

    public function test_admin_check_accepts_matching_slug_with_prefix(): void
    {
        $user = User::factory()->create([
            'role' => 'competitor',
            'startgg_user_id' => '55',
        ]);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'real-tournament',
                'isAdminEvent' => true,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => '55',
                'adminIds' => [],
                'isAdmin' => true,
            ]);
        });

        $this->mock(StartggAppClient::class, function ($mock) {
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminUserIds' => [],
                'admins' => [],
            ]);
        });

        $this->getJson('/api/events/10/admin-check?tournamentSlug=tournament/real-tournament')
            ->assertOk()
            ->assertJsonPath('isAdmin', true);
    }

    public function test_approve_invalidates_set_and_event_caches(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'startgg_user_id' => '55']);
        $reporter = User::factory()->create(['role' => 'competitor']);
        $report = $this->createPendingReport($reporter);

        Sanctum::actingAs($admin);

        $setKey = "set_detail_{$report->set_id}";
        $adminKey = "event_isadmin_{$report->event_id}_user_{$admin->id}";

        Cache::put($setKey, ['cached' => true], 600);
        Cache::put($adminKey, true, 600);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'event-slug',
                'isAdminEvent' => true,
            ]);
            $mock->shouldReceive('reportSet')->once()->andReturn(['ok' => true]);
        });

        $this->mock(StartggAppClient::class, function ($mock) {
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminUserIds' => [],
                'admins' => [],
            ]);
        });

        $this->postJson('/api/admin/reports/' . $report->id . '/approve')
            ->assertOk();

        $this->assertFalse(Cache::has($setKey));
        $this->assertFalse(Cache::has($adminKey));
    }
}
