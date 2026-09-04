<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StartggAppClient
{
    private string $endpoint;
    private ?string $token;

    public function __construct()
    {
        $this->endpoint = config('startgg.api_url');
        $this->token = env('STARTGG_APP_TOKEN');
    }

    public function getTournamentAdminInfo(string $slug): array
    {
        if (empty($this->token)) {
            Log::warning('STARTGG_APP_TOKEN missing; cannot fetch tournament admins');
            return ['admins' => [], 'ownerId' => null, 'adminUserIds' => []];
        }
        $normalized = $this->normalizeSlug($slug);

        // IMPORTANTE: el campo `admins` devuelve [User], por lo que el `id` ya es el
        // user id (NO existe un subcampo `user` en User). Además hay que pasar el
        // argumento `roles` o start.gg no devuelve Managers/Bracket Managers/Reporters.
        $query = <<<'GQL'
        query TournamentAdmins($slug: String!, $roles: [String]) {
          tournament(slug: $slug) {
            id
            name
            owner { id }
            admins(roles: $roles) {
              id
              name
              slug
            }
          }
        }
        GQL;

                $participantsAdminsQuery = <<<'GQL'
                query TournamentParticipantsAdmins($slug: String!, $page: Int!, $perPage: Int!) {
                    tournament(slug: $slug) {
                        id
                        owner { id }
                        participants(query: {page: $page, perPage: $perPage}, isAdmin: true) {
                            nodes {
                                id
                                user { id slug }
                            }
                            pageInfo { total totalPages }
                        }
                    }
                }
                GQL;

        // Try normalized first, then raw slug if empty
        $slugsToTry = array_values(array_unique(array_filter([$normalized, $slug])));

        foreach ($slugsToTry as $slugToUse) {
            $resp = Http::withToken($this->token)
                ->acceptJson()
                ->post($this->endpoint, [
                    'query' => $query,
                    'variables' => [
                        'slug' => $slugToUse,
                        'roles' => \App\Services\StartggClient::TOURNAMENT_ADMIN_ROLES,
                    ],
                ]);

            if ($resp->failed()) {
                Log::warning('start.gg app admin lookup failed', [
                    'slug' => $slugToUse,
                    'status' => $resp->status(),
                    'body' => $resp->body(),
                ]);
                continue;
            }

            $json = $resp->json();
            $admins = data_get($json, 'data.tournament.admins', []);
            $ownerId = data_get($json, 'data.tournament.owner.id');

            Log::info('start.gg app admin lookup ok', [
                'slug' => $slugToUse,
                'owner_id' => $ownerId,
                'admin_count' => is_array($admins) ? count($admins) : 0,
                'admins_sample' => is_array($admins) ? array_slice($admins, 0, 3) : null,
            ]);

            $adminsList = is_array($admins) ? $admins : [];

            // Fallback: if admins list is empty, try participants with isAdmin=true (documented in schema)
            if (count($adminsList) === 0) {
                $resp2 = Http::withToken($this->token)
                    ->acceptJson()
                    ->post($this->endpoint, [
                        'query' => $participantsAdminsQuery,
                        'variables' => [
                            'slug' => $slugToUse,
                            'page' => 1,
                            'perPage' => 50,
                        ],
                    ]);

                if ($resp2->successful()) {
                    $json2 = $resp2->json();
                    $adminsFromParticipants = data_get($json2, 'data.tournament.participants.nodes', []);
                    $ownerId = data_get($json2, 'data.tournament.owner.id', $ownerId);
                    Log::info('start.gg app admins via participants', [
                        'slug' => $slugToUse,
                        'owner_id' => $ownerId,
                        'admin_count' => is_array($adminsFromParticipants) ? count($adminsFromParticipants) : 0,
                        'admins_sample' => is_array($adminsFromParticipants) ? array_slice($adminsFromParticipants, 0, 3) : null,
                        'pageInfo' => data_get($json2, 'data.tournament.participants.pageInfo'),
                    ]);
                    $adminsList = is_array($adminsFromParticipants) ? $adminsFromParticipants : [];
                } else {
                    Log::warning('start.gg app participants admin lookup failed', [
                        'slug' => $slugToUse,
                        'status' => $resp2->status(),
                        'body' => $resp2->body(),
                    ]);
                }
            }

            // `admins` devuelve [User]: el id del nodo ES el user id. Mantenemos
            // el fallback a `user.id` por si la lista vino de participants(isAdmin).
            $adminUserIds = collect($adminsList)
                ->map(fn ($admin) => data_get($admin, 'user.id') ?? data_get($admin, 'id'))
                ->filter()
                ->map(fn ($id) => (string) $id)
                ->values()
                ->all();

            Log::info('start.gg app admins users', [
                'slug' => $slugToUse,
                'owner_id' => $ownerId,
                'admin_user_ids_count' => count($adminUserIds),
                'admin_user_ids_sample' => array_slice($adminUserIds, 0, 5),
            ]);

            return [
                'admins' => $adminsList,
                'ownerId' => $ownerId,
                'adminUserIds' => $adminUserIds,
            ];
        }

        return ['admins' => [], 'ownerId' => null, 'adminUserIds' => []];
    }

    public function isUserTournamentAdmin(string $slug, string|int $userId): bool
    {
        $info = $this->getTournamentAdminInfo($slug);

        if (!empty($info['ownerId']) && (string)$info['ownerId'] === (string)$userId) {
            return true;
        }

        return collect($info['admins'] ?? [])->contains(function ($admin) use ($userId) {
            // admins array usually returns users directly; fall back to nested user
            $adminId = data_get($admin, 'id') ?? data_get($admin, 'user.id');
            return (string) $adminId === (string) $userId;
        });
    }

    private function normalizeSlug(string $slug): string
    {
        return ltrim(preg_replace('/^tournament\//', '', $slug) ?? '', '/');
    }
}
