<?php

namespace Tests\Feature;

use App\Models\Game;
use App\Models\Report;
use App\Models\User;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminReportFlowTest extends TestCase
{
    use RefreshDatabase;

    private function createPendingReport(
        User $user,
        int $eventId = 10,
        string $setId = 'set-1',
    ): Report
    {
        $report = Report::create([
            'user_id' => $user->id,
            'event_id' => $eventId,
            'event_name' => "Event {$eventId}",
            'set_id' => $setId,
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

    public function test_global_report_list_only_includes_administered_events(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'startgg_user_id' => '55']);
        $reporter = User::factory()->create(['role' => 'competitor']);
        $authorizedReport = $this->createPendingReport($reporter, 10, 'set-10');
        $foreignReport = $this->createPendingReport($reporter, 20, 'set-20');

        Sanctum::actingAs($admin);
        Cache::put("event_isadmin_10_user_{$admin->id}", true, 600);
        Cache::put("event_isadmin_20_user_{$admin->id}", false, 600);

        $this->getJson('/api/admin/reports?status=pending')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonFragment(['id' => $authorizedReport->id])
            ->assertJsonMissing(['id' => $foreignReport->id]);
    }

    public function test_admin_routes_require_admin_role(): void
    {
        $user = User::factory()->create(['role' => 'competitor']);
        Sanctum::actingAs($user);

        $this->getJson('/api/admin/reports')->assertStatus(403);
    }

    public function test_admin_can_list_and_view_reports(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'startgg_user_id' => '55']);
        $reporter = User::factory()->create(['role' => 'competitor']);
        $report = $this->createPendingReport($reporter);

        Sanctum::actingAs($admin);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'event-slug',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminIds' => ['55'],
                'isAdmin' => false,
            ]);
        });

        $this->getJson('/api/admin/reports?eventId=10')
            ->assertOk()
            ->assertJsonFragment(['id' => $report->id]);

        $this->getJson('/api/admin/reports')
            ->assertOk()
            ->assertJsonFragment(['id' => $report->id]);

        $this->getJson('/api/admin/reports/' . $report->id)
            ->assertOk()
            ->assertJsonPath('status', 'pending')
            ->assertJsonPath('games.0.stage', 'Battlefield');
    }

    public function test_admin_can_approve_report(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'startgg_user_id' => '55']);
        $reporter = User::factory()->create(['role' => 'competitor']);
        $report = $this->createPendingReport($reporter);

        Sanctum::actingAs($admin);

        $this->mock(StartggClient::class, function ($mock) use ($admin, $report) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'event-slug',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminIds' => ['55'],
                'isAdmin' => false,
            ]);
            $mock->shouldReceive('reportSet')
                ->once()
                ->with(
                    $admin,
                    $report->set_id,
                    $report->p1_entrant_id,
                    \Mockery::type(Report::class)
                );
        });

        $this->postJson('/api/admin/reports/' . $report->id . '/approve')
            ->assertOk()
            ->assertJsonPath('message', 'Report approved and submitted to start.gg');

        $this->assertSame('approved', $report->fresh()->status);
    }

    public function test_admin_can_reject_report(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'startgg_user_id' => '55']);
        $reporter = User::factory()->create(['role' => 'competitor']);
        $report = $this->createPendingReport($reporter);

        Sanctum::actingAs($admin);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'event-slug',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminIds' => ['55'],
                'isAdmin' => false,
            ]);
        });

        $this->postJson('/api/admin/reports/' . $report->id . '/reject', ['reason' => 'Invalid'])
            ->assertOk()
            ->assertJsonPath('message', 'Report rejected');

        $this->assertSame('rejected', $report->fresh()->status);
    }

    public function test_admin_can_edit_a_rejected_report_and_restore_pending_status(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'startgg_user_id' => '55']);
        $reporter = User::factory()->create(['role' => 'competitor']);
        $report = $this->createPendingReport($reporter);
        $report->status = 'rejected';
        $report->rejection_reason = 'Wrong score';
        $report->save();

        Sanctum::actingAs($admin);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'event-slug',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminIds' => ['55'],
                'isAdmin' => false,
            ]);
        });

        $payload = [
            'games' => [
                [
                    'index' => 1,
                    'stage' => 'Battlefield',
                    'winner' => 'p2',
                    'stocksP1' => 0,
                    'stocksP2' => 2,
                    'characterP1' => 'mario',
                    'characterP2' => 'fox',
                ],
            ],
            'notes' => 'Corrected report',
        ];

        $this->putJson('/api/admin/reports/' . $report->id, $payload)
            ->assertOk()
            ->assertJsonPath('status', 'pending')
            ->assertJsonPath('rejectionReason', null)
            ->assertJsonPath('notes', 'Corrected report');
    }
}

