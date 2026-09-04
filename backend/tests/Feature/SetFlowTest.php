<?php

namespace Tests\Feature;

use App\Models\Report;
use App\Models\SetDraft;
use App\Models\SetState;
use App\Models\User;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SetFlowTest extends TestCase
{
    use RefreshDatabase;

    private function mockSetDetail(string $userId): array
    {
        return [
            'id' => 'set-1',
            'eventId' => 10,
            'eventName' => 'Event',
            'round' => 'Winners R1',
            'bestOf' => 3,
            'p1' => [
                'userId' => $userId,
                'entrantId' => 111,
                'name' => 'Player 1',
            ],
            'p2' => [
                'userId' => '99',
                'entrantId' => 222,
                'name' => 'Player 2',
            ],
        ];
    }

    public function test_submit_report_creates_report_and_games(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) use ($user) {
            $mock->shouldReceive('getSetDetail')->andReturn(array_merge($this->mockSetDetail($user->startgg_user_id), ['status' => 'in_progress']));
        });

        $payload = [
            'games' => [
                [
                    'index' => 1,
                    'stage' => 'Battlefield',
                    'winner' => 'p1',
                    'stocksP1' => 2,
                    'stocksP2' => 0,
                    'characterP1' => 'mario',
                    'characterP2' => 'fox',
                ],
                [
                    'index' => 2,
                    'stage' => 'Final Destination',
                    'winner' => 'p1',
                    'stocksP1' => 1,
                    'stocksP2' => 0,
                    'characterP1' => 'mario',
                    'characterP2' => 'fox',
                ],
            ],
            'notes' => 'Good set',
        ];

        $this->postJson('/api/sets/set-1/submit', $payload)
            ->assertStatus(201)
            ->assertJsonPath('report.status', 'pending');

        $this->assertSame(1, Report::count());
        $this->assertSame(2, Report::first()->games()->count());
    }

    public function test_submit_report_rejects_non_participant(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getSetDetail')->andReturn([
                'id' => 'set-1',
                'eventId' => 10,
                'eventName' => 'Event',
                'round' => 'Winners R1',
                'bestOf' => 3,
                'status' => 'in_progress',
                'p1' => ['userId' => '1', 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '2', 'entrantId' => 222, 'name' => 'Player 2'],
            ]);
        });

        $payload = [
            'games' => [
                [
                    'index' => 1,
                    'stage' => 'Battlefield',
                    'winner' => 'p1',
                    'stocksP1' => 2,
                    'stocksP2' => 0,
                    'characterP1' => 'mario',
                    'characterP2' => 'fox',
                ],
            ],
        ];

        $this->postJson('/api/sets/set-1/submit', $payload)
            ->assertStatus(403)
            ->assertJsonPath('error', 'Unauthorized');
    }

    public function test_submit_report_validates_payload(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        $this->postJson('/api/sets/set-1/submit', [])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Validation failed');
    }

    public function test_start_set_returns_success(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'admin',
        ]);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) use ($user) {
            $mock->shouldReceive('getSetDetail')->andReturn([
                'id' => 'set-1',
                'eventId' => 10,
                'eventName' => 'Event',
                'round' => 'Winners R1',
                'bestOf' => 3,
                'status' => 'not_started',
                'p1' => ['userId' => $user->startgg_user_id, 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '99', 'entrantId' => 222, 'name' => 'Player 2'],
            ]);
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'event-slug',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => null,
                'adminIds' => ['55'],
                'isAdmin' => false,
            ]);
            $mock->shouldReceive('markSetInProgress')->andReturn(['id' => 'set-1', 'state' => 2]);
        });

        $this->postJson('/api/sets/set-1/start', ['bestOf' => 3])
            ->assertOk()
            ->assertJsonPath('message', 'Set marked as in progress');
    }

    public function test_start_set_with_preview_id_calls_startgg(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'admin',
        ]);
        Sanctum::actingAs($user);

        Cache::put("event_admincheck_10_user_{$user->id}", ['isAdmin' => true, 'slug' => 'event-slug'], 600);
        Cache::put("event_isadmin_10_user_{$user->id}", true, 600);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldNotReceive('getSetDetail');
            $mock->shouldReceive('getEventSets')->once()->with(
                \Mockery::type(User::class),
                10
            )->andReturn([
                [
                    'id' => 'preview_3136342_1_31',
                    'eventId' => 10,
                    'status' => 'not_started',
                ],
            ]);
            $mock->shouldReceive('markSetInProgress')
                ->once()
                ->andReturn(['id' => 'preview_3136342_1_31', 'state' => 2]);
        });

        $this->postJson('/api/sets/preview_3136342_1_31/start', ['bestOf' => 3, 'eventId' => 10])
            ->assertOk()
            ->assertJsonPath('message', 'Set marked as in progress');
    }

    public function test_start_set_with_event_id_verifies_membership_and_keeps_admin_cache(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'admin',
        ]);
        Sanctum::actingAs($user);

        Cache::put("event_admincheck_10_user_{$user->id}", ['isAdmin' => true, 'slug' => 'event-slug'], 600);
        Cache::put("event_isadmin_10_user_{$user->id}", true, 600);
        Cache::put('event_10_sets_all', [
            ['id' => 'set-1', 'status' => 'not_started', 'bestOf' => 3],
            ['id' => 'set-2', 'status' => 'not_started', 'bestOf' => 3],
        ], 600);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldNotReceive('getSetDetail');
            $mock->shouldNotReceive('getEvent');
            $mock->shouldNotReceive('getTournamentAdminInfo');
            $mock->shouldReceive('getEventSets')->once()->with(
                \Mockery::type(User::class),
                10
            )->andReturn([
                [
                    'id' => 'set-1',
                    'eventId' => 10,
                    'status' => 'not_started',
                ],
            ]);
            $mock->shouldReceive('markSetInProgress')->once()->andReturn(['id' => 'set-1', 'state' => 2]);
        });

        $this->postJson('/api/sets/set-1/start', ['bestOf' => 5, 'eventId' => 10])
            ->assertOk()
            ->assertJsonPath('message', 'Set marked as in progress');

        $cached = Cache::get('event_10_sets_all');
        $this->assertSame('not_started', $cached[0]['status']);
        $this->assertSame(3, $cached[0]['bestOf']);
        $this->assertSame('not_started', $cached[1]['status']);
        $this->assertTrue(Cache::get("event_isadmin_10_user_{$user->id}"));
    }

    public function test_start_set_resets_stale_local_state_after_startgg_accepts(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'admin',
        ]);
        Sanctum::actingAs($user);

        Cache::put("event_isadmin_10_user_{$user->id}", true, 600);
        SetState::create([
            'set_id' => 'set-1',
            'phase' => 'picked',
            'best_of' => 5,
            'bans' => ['Battlefield'],
        ]);
        SetDraft::create([
            'set_id' => 'set-1',
            'user_id' => $user->id,
            'data' => ['games' => [['index' => 1]]],
            'status' => 'draft',
        ]);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEventSets')->once()->andReturn([
                ['id' => 'set-1', 'eventId' => 10, 'status' => 'not_started'],
            ]);
            $mock->shouldReceive('markSetInProgress')->once()->andReturn(['id' => 'set-1', 'state' => 2]);
        });

        $this->postJson('/api/sets/set-1/start', ['bestOf' => 3, 'eventId' => 10])
            ->assertOk();

        $this->assertDatabaseMissing('set_drafts', ['set_id' => 'set-1']);
        $this->assertDatabaseHas('set_states', [
            'set_id' => 'set-1',
            'phase' => 'rps',
            'best_of' => 3,
        ]);
    }

    public function test_start_set_rejects_event_mismatch_without_deleting_local_data(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'admin',
        ]);
        Sanctum::actingAs($user);

        Cache::put("event_isadmin_10_user_{$user->id}", true, 600);
        SetState::create([
            'set_id' => 'set-1',
            'phase' => 'banning',
            'best_of' => 5,
            'bans' => [],
        ]);
        SetDraft::create([
            'set_id' => 'set-1',
            'user_id' => $user->id,
            'data' => ['games' => []],
            'status' => 'draft',
        ]);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEventSets')->once()->andReturn([
                ['id' => 'another-set', 'eventId' => 10, 'status' => 'not_started'],
            ]);
            $mock->shouldNotReceive('markSetInProgress');
        });

        $this->postJson('/api/sets/set-1/start', ['bestOf' => 3, 'eventId' => 10])
            ->assertStatus(409)
            ->assertJsonPath('code', 'tournament_mismatch');

        $this->assertDatabaseHas('set_states', ['set_id' => 'set-1', 'phase' => 'banning']);
        $this->assertDatabaseHas('set_drafts', ['set_id' => 'set-1', 'user_id' => $user->id]);
    }

    public function test_startgg_failure_does_not_delete_local_data(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'admin',
        ]);
        Sanctum::actingAs($user);

        Cache::put("event_isadmin_10_user_{$user->id}", true, 600);
        SetState::create([
            'set_id' => 'set-1',
            'phase' => 'banning',
            'best_of' => 5,
            'bans' => [],
        ]);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEventSets')->once()->andReturn([
                ['id' => 'set-1', 'eventId' => 10, 'status' => 'not_started'],
            ]);
            $mock->shouldReceive('markSetInProgress')->once()
                ->andThrow(new \RuntimeException('start.gg unavailable'));
        });

        $this->postJson('/api/sets/set-1/start', ['bestOf' => 3, 'eventId' => 10])
            ->assertStatus(500);

        $this->assertDatabaseHas('set_states', ['set_id' => 'set-1', 'phase' => 'banning']);
    }

    public function test_submit_report_rejects_duplicate_pending_report(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        Report::create([
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
        ]);

        $this->mock(StartggClient::class, function ($mock) use ($user) {
            $mock->shouldReceive('getSetDetail')->andReturn(array_merge($this->mockSetDetail($user->startgg_user_id), ['status' => 'in_progress']));
        });

        $payload = [
            'games' => [
                [
                    'index' => 1,
                    'stage' => 'Battlefield',
                    'winner' => 'p1',
                    'stocksP1' => 2,
                    'stocksP2' => 0,
                    'characterP1' => 'mario',
                    'characterP2' => 'fox',
                ],
            ],
        ];

        $this->postJson('/api/sets/set-1/submit', $payload)
            ->assertStatus(409)
            ->assertJsonPath('error', 'Report already pending');
    }

    public function test_start_set_rejects_non_admin_event_user(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getSetDetail')->andReturn([
                'id' => 'set-1',
                'eventId' => 10,
                'eventName' => 'Event',
                'round' => 'Winners R1',
                'bestOf' => 3,
                'status' => 'not_started',
                'p1' => ['userId' => '55', 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '99', 'entrantId' => 222, 'name' => 'Player 2'],
            ]);
            $mock->shouldReceive('getEvent')->andReturn(['isAdminEvent' => false, 'tournamentSlug' => 'event-slug']);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn(['ownerId' => null, 'adminIds' => []]);
        });

        $this->postJson('/api/sets/set-1/start', ['bestOf' => 5])
            ->assertStatus(403)
            ->assertJsonPath('message', 'Solo los administradores del torneo pueden iniciar sets');
    }
}

