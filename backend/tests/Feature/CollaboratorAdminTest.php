<?php

namespace Tests\Feature;

use App\Models\Report;
use App\Models\User;
use App\Services\StartggAppClient;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Verifica que un admin COLABORADOR (no owner) — detectado vía el token OAuth
 * del propio usuario con el argumento roles: Administrator/Manager/Bracket
 * Manager/Reporter — puede usar las funciones de administración de la app.
 *
 * Regresión del bug: antes solo el owner podía iniciar sets / aprobar reportes.
 */
class CollaboratorAdminTest extends TestCase
{
    use RefreshDatabase;

    private function mockSetDetail(): array
    {
        return [
            'id' => 'set-1',
            'eventId' => 10,
            'eventName' => 'Event',
            'status' => 'in_progress',
            'round' => 'Winners R1',
            'bestOf' => 3,
            'p1' => ['userId' => '111', 'entrantId' => 111, 'name' => 'Player 1'],
            'p2' => ['userId' => '222', 'entrantId' => 222, 'name' => 'Player 2'],
        ];
    }

    public function test_collaborator_admin_can_start_set(): void
    {
        $admin = User::factory()->create(['startgg_user_id' => '55', 'role' => 'competitor']);
        Sanctum::actingAs($admin);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getSetDetail')->andReturn($this->mockSetDetail());
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'my-tourney',
                'isAdminEvent' => false, // NO es owner
            ]);
            // El usuario aparece como admin delegado (rol Manager/Reporter/etc.)
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => '999',
                'adminIds' => ['55'],
                'isAdmin' => true,
            ]);
            $mock->shouldReceive('markSetInProgress')->andReturn(['id' => 'set-1', 'state' => 2]);
        });

        $this->mock(StartggAppClient::class, function ($mock) {
            // Sin STARTGG_APP_TOKEN: esta fuente no aporta nada
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'admins' => [], 'ownerId' => null, 'adminUserIds' => [],
            ]);
        });

        $this->postJson('/api/sets/set-1/start')
            ->assertOk()
            ->assertJsonPath('message', 'Set marked as in progress');
    }

    public function test_collaborator_detected_via_is_admin_flag_without_id_list_match(): void
    {
        $admin = User::factory()->create(['startgg_user_id' => '55', 'role' => 'competitor']);
        Sanctum::actingAs($admin);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getSetDetail')->andReturn($this->mockSetDetail());
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'my-tourney',
                'isAdminEvent' => false,
            ]);
            // Lista con formato distinto; isAdmin ya resuelto por el cliente
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => '999',
                'adminIds' => [],
                'isAdmin' => true,
            ]);
            $mock->shouldReceive('markSetInProgress')->andReturn(['id' => 'set-1', 'state' => 2]);
        });

        $this->mock(StartggAppClient::class, function ($mock) {
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'admins' => [], 'ownerId' => null, 'adminUserIds' => [],
            ]);
        });

        $this->postJson('/api/sets/set-1/start')
            ->assertOk();
    }

    public function test_non_admin_cannot_start_set(): void
    {
        $user = User::factory()->create(['startgg_user_id' => '77', 'role' => 'competitor']);
        Sanctum::actingAs($user);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getSetDetail')->andReturn($this->mockSetDetail());
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'my-tourney',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => '999',
                'adminIds' => ['55'], // 77 no está
                'isAdmin' => false,
            ]);
            $mock->shouldReceive('markSetInProgress')->andReturn(['id' => 'set-1', 'state' => 2]);
        });

        $this->mock(StartggAppClient::class, function ($mock) {
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'admins' => [], 'ownerId' => null, 'adminUserIds' => [],
            ]);
        });

        $this->postJson('/api/sets/set-1/start')
            ->assertStatus(403);
    }

    public function test_collaborator_admin_can_list_reports(): void
    {
        $admin = User::factory()->create(['startgg_user_id' => '55', 'role' => 'admin']);
        Sanctum::actingAs($admin);

        Report::create([
            'user_id' => $admin->id,
            'event_id' => 10,
            'event_name' => 'Event',
            'set_id' => 'set-1',
            'round' => 'WR1',
            'p1_entrant_id' => 111, 'p1_name' => 'P1',
            'p2_entrant_id' => 222, 'p2_name' => 'P2',
            'score_p1' => 2, 'score_p2' => 0,
            'status' => 'pending',
        ]);

        $this->mock(StartggClient::class, function ($mock) {
            $mock->shouldReceive('getEvent')->andReturn([
                'tournamentSlug' => 'my-tourney',
                'isAdminEvent' => false,
            ]);
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'ownerId' => '999',
                'adminIds' => ['55'],
                'isAdmin' => false,
            ]);
        });

        $this->mock(StartggAppClient::class, function ($mock) {
            $mock->shouldReceive('getTournamentAdminInfo')->andReturn([
                'admins' => [], 'ownerId' => null, 'adminUserIds' => [],
            ]);
        });

        $this->getJson('/api/admin/reports?eventId=10')
            ->assertOk()
            ->assertJsonCount(1);
    }
}
