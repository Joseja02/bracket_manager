<?php

namespace Tests\Feature;

use App\Models\Report;
use App\Models\SetState;
use App\Models\User;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SetStateMatrixTest extends TestCase
{
    use RefreshDatabase;

    public function test_submit_report_rejects_when_set_is_not_in_progress(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
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
                'p1' => ['userId' => '55', 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '99', 'entrantId' => 222, 'name' => 'Player 2'],
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
            ->assertStatus(409)
            ->assertJsonPath('error', 'Set not in progress');

        $this->assertSame(0, Report::count());
    }

    public function test_rps_rejects_when_state_is_not_in_rps_phase(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        SetState::create([
            'set_id' => 'set-1',
            'best_of' => 3,
            'phase' => 'banning',
            'bans' => [],
        ]);

        $this->mock(StartggClient::class, function ($mock) use ($user) {
            $mock->shouldReceive('getSetDetail')->andReturn([
                'id' => 'set-1',
                'eventId' => 10,
                'eventName' => 'Event',
                'round' => 'Winners R1',
                'bestOf' => 3,
                'status' => 'in_progress',
                'p1' => ['userId' => '55', 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '99', 'entrantId' => 222, 'name' => 'Player 2'],
            ]);
        });

        $this->postJson('/api/sets/set-1/rps', ['choice' => 'rock'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'RPS phase not active');
    }

    public function test_ban_rejects_when_state_is_not_in_banning_phase(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        SetState::create([
            'set_id' => 'set-1',
            'best_of' => 3,
            'phase' => 'picked',
            'bans' => [],
        ]);

        $this->mock(StartggClient::class, function ($mock) use ($user) {
            $mock->shouldReceive('getSetDetail')->andReturn([
                'id' => 'set-1',
                'eventId' => 10,
                'eventName' => 'Event',
                'round' => 'Winners R1',
                'bestOf' => 3,
                'status' => 'in_progress',
                'p1' => ['userId' => '55', 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '99', 'entrantId' => 222, 'name' => 'Player 2'],
            ]);
        });

        $this->postJson('/api/sets/set-1/bans', ['stage' => 'Battlefield'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'Banning phase not active');
    }

    public function test_rps_moves_to_banning_after_both_players_choose(): void
    {
        $p1 = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        $p2 = User::factory()->create([
            'startgg_user_id' => '99',
            'role' => 'competitor',
        ]);

        SetState::create([
            'set_id' => 'set-1',
            'best_of' => 3,
            'phase' => 'rps',
            'bans' => [],
            'p1_choice' => null,
            'p2_choice' => null,
        ]);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getSetDetail')->andReturn([
                'id' => 'set-1',
                'eventId' => 10,
                'eventName' => 'Event',
                'round' => 'Winners R1',
                'bestOf' => 3,
                'status' => 'in_progress',
                'p1' => ['userId' => '55', 'entrantId' => 111, 'name' => 'Player 1'],
                'p2' => ['userId' => '99', 'entrantId' => 222, 'name' => 'Player 2'],
            ]);
        });

        Sanctum::actingAs($p1);
        $this->postJson('/api/sets/set-1/rps', ['choice' => 'rock'])
            ->assertOk()
            ->assertJsonPath('phase', 'rps');

        Sanctum::actingAs($p2);
        $this->postJson('/api/sets/set-1/rps', ['choice' => 'paper'])
            ->assertOk()
            ->assertJsonPath('phase', 'banning');
    }

    public function test_save_and_fetch_draft_persists_user_specific_state(): void
    {
        $user = User::factory()->create([
            'startgg_user_id' => '55',
            'role' => 'competitor',
        ]);
        Sanctum::actingAs($user);

        $payload = [
            'data' => [
                'phase' => 'banning',
                'games' => [
                    ['index' => 1, 'winner' => 'p1'],
                ],
            ],
        ];

        $this->postJson('/api/sets/set-1/draft', $payload)
            ->assertOk()
            ->assertJsonPath('data.phase', 'banning');

        $this->assertDatabaseHas('set_drafts', [
            'set_id' => 'set-1',
            'user_id' => $user->id,
            'status' => 'draft',
        ]);

        $this->getJson('/api/sets/set-1/draft')
            ->assertOk()
            ->assertJsonPath('data.phase', 'banning');
    }

    public function test_spectate_reports_not_started_sets_as_unavailable(): void
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
        });

        $this->getJson('/api/sets/set-1/spectate')
            ->assertStatus(409)
            ->assertJsonPath('reason', 'not_started');
    }
}
