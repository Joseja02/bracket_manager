<?php

namespace Tests\Feature;

use App\Models\SetState;
use App\Models\User;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventSetsTest extends TestCase
{
    use RefreshDatabase;

    public function test_get_sets_always_calls_startgg(): void
    {
        $user = User::factory()->create(['role' => 'competitor', 'startgg_user_id' => '77']);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEventSets')->once()->andReturn([
                [
                    'id' => '106633426',
                    'eventId' => '10',
                    'eventName' => 'Test Event',
                    'round' => 'Winners R1',
                    'bestOf' => 3,
                    'p1' => ['userId' => null, 'entrantId' => 111, 'name' => 'Player 1'],
                    'p2' => ['userId' => null, 'entrantId' => 222, 'name' => 'Player 2'],
                    'status' => 'not_started',
                ],
            ]);
        });

        $this->getJson('/api/events/10/sets')
            ->assertOk()
            ->assertJsonPath('0.id', '106633426')
            ->assertJsonPath('0.p1.name', 'Player 1')
            ->assertJsonPath('0.status', 'not_started');
    }

    public function test_get_sets_keeps_startgg_status_when_set_state_exists(): void
    {
        $user = User::factory()->create(['role' => 'competitor', 'startgg_user_id' => '77']);
        Sanctum::actingAs($user);

        SetState::create([
            'set_id' => 'set-1',
            'bans' => [],
            'phase' => 'rps',
            'best_of' => 5,
        ]);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEventSets')->once()->andReturn([
                [
                    'id' => 'set-1',
                    'eventId' => '10',
                    'eventName' => 'Test Event',
                    'round' => 'Winners R1',
                    'bestOf' => 3,
                    'p1' => ['userId' => null, 'entrantId' => 111, 'name' => 'Player 1'],
                    'p2' => ['userId' => null, 'entrantId' => 222, 'name' => 'Player 2'],
                    'status' => 'not_started',
                ],
            ]);
        });

        $this->getJson('/api/events/10/sets')
            ->assertOk()
            ->assertJsonPath('0.id', 'set-1')
            ->assertJsonPath('0.status', 'not_started')
            ->assertJsonPath('0.bestOf', 5);
    }

    public function test_get_sets_keeps_preview_ids_from_startgg(): void
    {
        $user = User::factory()->create(['role' => 'competitor', 'startgg_user_id' => '77']);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEventSets')->once()->andReturn([
                [
                    'id' => 'preview_3136342_1_1',
                    'eventId' => '10',
                    'eventName' => 'Test Event',
                    'round' => 'Winners R1',
                    'bestOf' => 3,
                    'p1' => ['userId' => null, 'entrantId' => 111, 'name' => 'Player 1'],
                    'p2' => ['userId' => null, 'entrantId' => 222, 'name' => 'Player 2'],
                    'status' => 'not_started',
                ],
                [
                    'id' => '106633426',
                    'eventId' => '10',
                    'eventName' => 'Test Event',
                    'round' => 'Winners R1',
                    'bestOf' => 3,
                    'p1' => ['userId' => null, 'entrantId' => 333, 'name' => 'Player 3'],
                    'p2' => ['userId' => null, 'entrantId' => 444, 'name' => 'Player 4'],
                    'status' => 'not_started',
                ],
            ]);
        });

        $this->getJson('/api/events/10/sets')
            ->assertOk()
            ->assertJsonCount(2)
            ->assertJsonPath('0.id', 'preview_3136342_1_1')
            ->assertJsonPath('1.id', '106633426');
    }
}
