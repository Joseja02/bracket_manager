<?php

namespace Tests\Unit;

use App\Models\User;
use App\Services\StartggAuth;
use App\Services\StartggClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use RuntimeException;
use Tests\TestCase;

class StartggClientTest extends TestCase
{
    use RefreshDatabase;
    use MockeryPHPUnitIntegration;

    public function test_query_refreshes_token_on_unauthorized(): void
    {
        config()->set('startgg.api_url_oauth', 'https://api.start.gg/gql/alpha');

        Http::fakeSequence('https://api.start.gg/gql/alpha')
            ->push([], 401)
            ->push(['data' => ['ok' => true]], 200);

        $auth = Mockery::mock(StartggAuth::class);
        $auth->shouldReceive('getValidToken')->once()->with(Mockery::type(User::class), 5)->andReturn('old-token');
        $auth->shouldReceive('refresh')->once()->with(Mockery::type(User::class))->andReturn('new-token');

        $client = new StartggClient($auth);
        $user = User::factory()->create(['startgg_access_token' => 'old-token']);

        $data = $client->query($user, 'query { ok }');

        $this->assertSame(['ok' => true], $data);
        Http::assertSentCount(2);
    }

    public function test_get_tournament_admin_info_collects_owner_and_admin_ids(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $client->shouldReceive('query')->once()->andReturn([
            'tournament' => [
                'owner' => ['id' => '99'],
                'admins' => [
                    ['id' => '12'],
                    ['id' => '34'],
                ],
                'participants' => [
                    'nodes' => [
                        ['user' => ['id' => '34']],
                        ['user' => ['id' => '56']],
                    ],
                ],
            ],
        ]);

        $user = User::factory()->create();

        $info = $client->getTournamentAdminInfo($user, 'my-event');

        $this->assertSame('99', $info['ownerId']);
        $this->assertEqualsCanonicalizing(['12', '34', '56'], $info['adminIds']);
        $this->assertFalse($info['isAdmin']);
    }

    public function test_get_tournament_admin_info_marks_matching_user_as_admin(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $client->shouldReceive('query')->andReturn([
            'tournament' => [
                'owner' => ['id' => '99'],
                'admins' => [
                    ['id' => '55'],
                    ['id' => '34'],
                ],
                'participants' => ['nodes' => []],
            ],
        ]);

        $user = User::factory()->create(['startgg_user_id' => '55']);
        $info = $client->getTournamentAdminInfo($user, 'my-event');

        $this->assertTrue($info['isAdmin']);
        $this->assertTrue(StartggClient::sameStartggUserId('55', '55'));
        $this->assertTrue(StartggClient::sameStartggUserId(55, '55'));
    }

    public function test_same_startgg_user_id_tolerates_format_differences(): void
    {
        $this->assertTrue(StartggClient::sameStartggUserId('12345', 12345));
        $this->assertTrue(StartggClient::sameStartggUserId('user/99', '99'));
        $this->assertFalse(StartggClient::sameStartggUserId('12', '34'));
        $this->assertFalse(StartggClient::sameStartggUserId(null, '1'));
    }

    public function test_get_event_asks_user_entrant_for_the_explicit_user_id(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $captured = [];
        $client->shouldReceive('query')
            ->once()
            ->andReturnUsing(function ($user, $query, $variables) use (&$captured) {
                $captured = ['query' => $query, 'variables' => $variables];

                return [
                    'event' => [
                        'id' => '1704834',
                        'name' => 'Ultimate Singles',
                        'startAt' => 1700000000,
                        'tournament' => [
                            'id' => '950936',
                            'name' => 'Stranger Spins 39',
                            'slug' => 'tournament/stranger-spins-39',
                            'owner' => ['id' => '99'],
                        ],
                        'userEntrant' => ['id' => '24682069'],
                    ],
                ];
            });

        $user = User::factory()->create(['startgg_user_id' => '730250']);
        $event = $client->getEvent($user, '1704834');

        // start.gg no resuelve el usuario autenticado en `userEntrant` sin
        // argumento (devuelve null), por eso el userId debe ir explícito.
        $this->assertStringContainsString('userEntrant(userId: $userId)', $captured['query']);
        $this->assertSame('730250', $captured['variables']['userId']);
        $this->assertSame('1704834', $captured['variables']['id']);
        $this->assertSame('24682069', $event['userEntrantId']);
    }

    public function test_get_event_without_startgg_user_id_sends_null_user_id(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $captured = [];
        $client->shouldReceive('query')
            ->once()
            ->andReturnUsing(function ($user, $query, $variables) use (&$captured) {
                $captured = $variables;

                return [
                    'event' => [
                        'id' => '1',
                        'name' => 'Event',
                        'startAt' => 1,
                        'tournament' => ['id' => '1', 'name' => 'T', 'slug' => 'tournament/t', 'owner' => ['id' => '9']],
                        'userEntrant' => null,
                    ],
                ];
            });

        $user = User::factory()->create(['startgg_user_id' => null]);
        $event = $client->getEvent($user, '1');

        $this->assertArrayHasKey('userId', $captured);
        $this->assertNull($captured['userId']);
        $this->assertNull($event['userEntrantId']);
    }

    public function test_get_event_sets_with_mine_uses_explicit_user_entrant(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $captured = [];
        $client->shouldReceive('query')
            ->once()
            ->andReturnUsing(function ($user, $query, $variables) use (&$captured) {
                $captured = ['query' => $query, 'variables' => $variables];

                return [
                    'event' => [
                        'name' => 'Test Event',
                        'userEntrant' => ['id' => 'e1'],
                        'sets' => [
                            'pageInfo' => ['totalPages' => 1],
                            'nodes' => [
                                [
                                    'id' => 'set-mine',
                                    'fullRoundText' => 'Winners R1',
                                    'round' => 1,
                                    'state' => 2,
                                    'slots' => [
                                        ['entrant' => ['id' => 'e1', 'name' => 'Joseja']],
                                        ['entrant' => ['id' => 'e2', 'name' => 'Rival']],
                                    ],
                                ],
                                [
                                    'id' => 'set-other',
                                    'fullRoundText' => 'Winners R1',
                                    'round' => 1,
                                    'state' => 2,
                                    'slots' => [
                                        ['entrant' => ['id' => 'e3', 'name' => 'Otro']],
                                        ['entrant' => ['id' => 'e4', 'name' => 'Rival 2']],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ];
            });

        $user = User::factory()->create(['startgg_user_id' => '730250']);
        $sets = $client->getEventSets($user, 1704834, ['mine' => true]);

        $this->assertStringContainsString('userEntrant(userId: $userId)', $captured['query']);
        $this->assertStringContainsString('$userId: ID', $captured['query']);
        $this->assertSame('730250', $captured['variables']['userId']);
        $this->assertCount(1, $sets);
        $this->assertSame('set-mine', $sets[0]['id']);
    }

    public function test_get_event_sets_without_mine_does_not_query_user_entrant(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $captured = [];
        $client->shouldReceive('query')
            ->once()
            ->andReturnUsing(function ($user, $query, $variables) use (&$captured) {
                $captured = $query;

                return [
                    'event' => [
                        'name' => 'Test Event',
                        'sets' => [
                            'pageInfo' => ['totalPages' => 1],
                            'nodes' => [
                                [
                                    'id' => 'set-1',
                                    'fullRoundText' => 'Winners R1',
                                    'round' => 1,
                                    'state' => 2,
                                    'slots' => [
                                        ['entrant' => ['id' => 'e1', 'name' => 'P1']],
                                        ['entrant' => ['id' => 'e2', 'name' => 'P2']],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ];
            });

        $user = User::factory()->create(['startgg_user_id' => '730250']);
        $client->getEventSets($user, 1704834);

        // Sin `mine` no se añade el campo ni la variable (evita coste extra).
        $this->assertStringNotContainsString('userEntrant', $captured);
        $this->assertStringNotContainsString('$userId', $captured);
    }

    public function test_get_event_sets_filters_and_maps_results(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $client->shouldReceive('query')->andReturn([
            'event' => [
                'name' => 'Test Event',
                'userEntrant' => ['id' => 'e1'],
                'sets' => [
                    'pageInfo' => ['totalPages' => 1],
                    'nodes' => [
                        [
                            'id' => 'set-1',
                            'fullRoundText' => 'Winners R1',
                            'round' => 1,
                            'state' => 2,
                            'phaseGroup' => [
                                'id' => 'pg1',
                                'displayIdentifier' => 'A',
                                'phase' => ['id' => 'ph1', 'name' => 'Pools'],
                            ],
                            'slots' => [
                                ['entrant' => ['id' => 'e1', 'name' => 'Player 1']],
                                ['entrant' => ['id' => 'e2', 'name' => 'Player 2']],
                            ],
                        ],
                        [
                            'id' => 'preview_3136342_1_1',
                            'fullRoundText' => 'Winners R1',
                            'round' => 1,
                            'state' => 1,
                            'slots' => [
                                ['entrant' => ['id' => 'e5', 'name' => 'Player 5']],
                                ['entrant' => ['id' => 'e6', 'name' => 'Player 6']],
                            ],
                        ],
                        [
                            'id' => 'set-2',
                            'fullRoundText' => 'Losers R1',
                            'round' => 1,
                            'state' => 1,
                            'slots' => [
                                ['entrant' => ['id' => 'e3', 'name' => 'TBD']],
                                ['entrant' => ['id' => 'e4', 'name' => 'Player 4']],
                            ],
                        ],
                    ],
                ],
            ],
        ]);

        $user = User::factory()->create();
        $sets = $client->getEventSets($user, 123);

        $this->assertCount(2, $sets);
        $this->assertSame('set-1', $sets[0]['id']);
        $this->assertSame('in_progress', $sets[0]['status']);
        $this->assertSame('Player 1', $sets[0]['p1']['name']);
        $this->assertSame('Player 2', $sets[0]['p2']['name']);
        $this->assertSame('Pool A', $sets[0]['poolLabel']);
        $this->assertNull($sets[0]['p1']['userId']);
        $this->assertSame('preview_3136342_1_1', $sets[1]['id']);
        $this->assertSame('not_started', $sets[1]['status']);
    }

    public function test_get_event_sets_paginates_when_total_pages_exceeds_one(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $node = function (string $id, string $name1, string $name2): array {
            return [
                'id' => $id,
                'fullRoundText' => 'Winners R1',
                'round' => 1,
                'state' => 1,
                'slots' => [
                    ['entrant' => ['id' => $id . '-e1', 'name' => $name1]],
                    ['entrant' => ['id' => $id . '-e2', 'name' => $name2]],
                ],
            ];
        };

        $client->shouldReceive('query')->twice()->andReturn(
            [
                'event' => [
                    'name' => 'Test Event',
                    'sets' => [
                        'pageInfo' => ['totalPages' => 2],
                        'nodes' => [$node('set-1', 'Player 1', 'Player 2')],
                    ],
                ],
            ],
            [
                'event' => [
                    'name' => 'Test Event',
                    'sets' => [
                        'pageInfo' => ['totalPages' => 2],
                        'nodes' => [$node('set-2', 'Player 3', 'Player 4')],
                    ],
                ],
            ],
        );

        $user = User::factory()->create();
        $sets = $client->getEventSets($user, 123);

        $this->assertCount(2, $sets);
        $this->assertSame('set-1', $sets[0]['id']);
        $this->assertSame('set-2', $sets[1]['id']);
        $this->assertSame('not_started', $sets[0]['status']);
        $this->assertSame('not_started', $sets[1]['status']);
    }

    public function test_mark_set_in_progress_throws_on_empty_result(): void
    {
        $auth = Mockery::mock(StartggAuth::class);
        $client = Mockery::mock(StartggClient::class, [$auth])->makePartial();

        $client->shouldReceive('query')->andReturn(['markSetInProgress' => null]);
        $client->shouldReceive('debugQuery')->andReturn([
            'json' => ['errors' => [['message' => 'Missing scope']]],
        ]);

        $user = User::factory()->create(['startgg_access_token' => 'token']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Failed to mark set in progress: Missing scope');

        $client->markSetInProgress($user, 'set-123');
    }
}

