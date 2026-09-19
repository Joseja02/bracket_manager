<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;
use App\Services\StartggClient;
use App\Services\StartggAppClient;
use App\Services\StartggErrorClassifier;
use App\Models\Report;
use App\Models\Game;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\SetState;
use App\Models\SetDraft;
use Illuminate\Support\Facades\Cache;

class SetController extends Controller
{
    use \App\Http\Concerns\ChecksEventAdmin;
    use \App\Http\Concerns\InvalidatesSetCaches;
    use \App\Http\Concerns\TracksSetEventBindings;

    public function __construct(
        private StartggClient $client,
        private StartggAppClient $appClient,
    ) {}

    /**
     * Obtener detalles de un set
     * GET /api/sets/{setId}
     */
    public function show(Request $request, $setId)
    {
        $user = Auth::user();
        
        try {
            $setDetail = $this->client->getSetDetail($user, $setId);
            $state = SetState::where('set_id', $setId)->first();
            if ($state?->best_of) {
                $setDetail['bestOf'] = (int) $state->best_of;
            }

            // Adjuntar reporte existente (pendiente/aprobado/rechazado) para bloquear reprocesos
            $existingReport = Report::with(['games', 'user'])
                ->where('set_id', $setId)
                ->latest()
                ->first();

            if ($existingReport && ($setDetail['status'] ?? null) !== 'not_started') {
                $setDetail['existingReport'] = [
                    'id' => $existingReport->id,
                    'status' => $existingReport->status,
                    'scoreP1' => $existingReport->score_p1,
                    'scoreP2' => $existingReport->score_p2,
                    'notes' => $existingReport->notes,
                    'rejectionReason' => $existingReport->rejection_reason,
                    'submittedBy' => $existingReport->user?->name,
                    'createdAt' => $existingReport->created_at?->toIso8601String(),
                    'games' => $existingReport->games->map(function ($game) {
                        return [
                            'index' => $game->game_index,
                            'stage' => $game->stage,
                            'winner' => $game->winner,
                            'stocksP1' => $game->stocks_p1,
                            'stocksP2' => $game->stocks_p2,
                            'characterP1' => $game->character_p1,
                            'characterP2' => $game->character_p2,
                        ];
                    })->values()->all(),
                ];
            }
            
            return response()->json($setDetail);
        } catch (\Throwable $e) {
            Log::error('Error fetching set detail', [
                'set_id' => $setId,
                'error' => $e->getMessage(),
            ]);
            
            return response()->json([
                'error' => 'Failed to fetch set detail',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Marcar un set como iniciado
     * POST /api/sets/{setId}/start
     */
    public function start(Request $request, $setId)
    {
        $user = Auth::user();
        $payload = $request->validate([
            'bestOf' => 'nullable|integer|in:3,5',
            'eventId' => 'nullable',
        ]);
        $bestOf = (int) ($payload['bestOf'] ?? 3);
        
        try {
            $requestedEventId = $payload['eventId'] ?? null;

            if ($requestedEventId !== null && $requestedEventId !== '') {
                if (!$this->isEventAdmin($user, $requestedEventId)) {
                    return response()->json([
                        'error' => 'Unauthorized',
                        'message' => 'Solo los administradores del torneo pueden iniciar sets',
                    ], 403);
                }

                $binding = $this->getSetEventBinding($setId);
                if ($binding
                    && (string) $binding['eventId'] !== (string) $requestedEventId) {
                    return response()->json([
                        'error' => 'Tournament mismatch',
                        'message' => 'El set no pertenece al evento indicado.',
                        'code' => StartggErrorClassifier::TOURNAMENT_MISMATCH,
                    ], 409);
                }

                if ($binding) {
                    // Relación observada recientemente en GET /events/{id}/sets.
                    // Permite iniciar preview_* aunque start.gg atraviese su breve
                    // ventana de consistencia eventual y devuelva una lista vacía.
                    $setDetail = [
                        'id' => $setId,
                        'eventId' => $binding['eventId'],
                        'status' => $binding['status'] ?? null,
                    ];
                } else {
                    $eventSets = $this->client->getEventSets($user, $requestedEventId);
                    $setDetail = collect($eventSets)->first(
                        fn (array $candidate) => (string) ($candidate['id'] ?? '') === (string) $setId
                    );

                    if ($setDetail) {
                        $this->rememberSetEventBindings([$setDetail], $requestedEventId);
                    } elseif (empty($eventSets)) {
                        // Una lista vacía no demuestra que el set pertenezca a
                        // otro evento: start.gg puede estar iniciando la phase.
                        // Para IDs normales intentamos la consulta individual.
                        if (!str_starts_with((string) $setId, 'preview_')) {
                            try {
                                $directSet = $this->client->getSetDetail($user, $setId);
                                if ((string) ($directSet['eventId'] ?? '') === (string) $requestedEventId) {
                                    $setDetail = $directSet;
                                }
                            } catch (\Throwable $lookupError) {
                                Log::warning('Direct set lookup failed after empty event list', [
                                    'set_id' => $setId,
                                    'event_id' => $requestedEventId,
                                    'error' => $lookupError->getMessage(),
                                ]);
                            }
                        }

                        if (!$setDetail) {
                            return response()->json([
                                'error' => 'Set lookup temporarily unavailable',
                                'message' => 'start.gg aún está actualizando los sets del evento. Inténtalo de nuevo.',
                                'code' => 'set_lookup_unavailable',
                            ], 503);
                        }
                    } else {
                        return response()->json([
                            'error' => 'Tournament mismatch',
                            'message' => 'El set no pertenece al evento indicado.',
                            'code' => StartggErrorClassifier::TOURNAMENT_MISMATCH,
                        ], 409);
                    }
                }

                $eventId = $requestedEventId;
            } else {
                $setDetail = $this->client->getSetDetail($user, $setId);
                $eventId = $setDetail['eventId'] ?? null;

                if (!$eventId || !$this->isEventAdmin($user, $eventId)) {
                    return response()->json([
                        'error' => 'Unauthorized',
                        'message' => 'Solo los administradores del torneo pueden iniciar sets',
                    ], 403);
                }
            }

            $shouldResetLocal = ($setDetail['status'] ?? null) === 'not_started';

            // start.gg debe aceptar la mutación antes de borrar cualquier estado
            // local. Así un error externo nunca destruye reportes o drafts.
            $startedAt = microtime(true);
            $result = $this->client->markSetInProgress($user, $setId);
            Log::info('Set start mutation timing', [
                'set_id' => $setId,
                'event_id' => $eventId,
                'ms' => (int) round((microtime(true) - $startedAt) * 1000),
                'had_event_id' => array_key_exists('eventId', $payload) && $payload['eventId'] !== null && $payload['eventId'] !== '',
            ]);

            DB::transaction(function () use ($setId, $bestOf, $shouldResetLocal) {
                if ($shouldResetLocal) {
                    Report::where('set_id', $setId)->delete();
                    SetDraft::where('set_id', $setId)->delete();
                    SetState::where('set_id', $setId)->delete();
                }

                $state = SetState::firstOrCreate(
                    ['set_id' => $setId],
                    ['bans' => [], 'phase' => 'rps']
                );
                $state->best_of = $bestOf;
                $state->save();
            });

            $this->invalidateSetCaches($setId, $eventId, $user->id, false);
            $this->forgetSetEventBinding($setId);

            return response()->json([
                'message' => 'Set marked as in progress',
                'set' => $result,
            ]);

        } catch (\RuntimeException $e) {
            // Errores esperados desde StartggClient (mensajes originales de Start.gg)
            $msg = $e->getMessage();

            Log::warning('Runtime error starting set', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $msg,
            ]);

            return StartggErrorClassifier::toJsonResponse($msg, 'Failed to start set');

        } catch (\Throwable $e) {
            Log::error('Error starting set', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => 'Failed to start set',
                'message' => $e->getMessage(),
                'code' => StartggErrorClassifier::UNKNOWN,
            ], 500);
        }
    }

    /**
     * Enviar reporte de un set
     * POST /api/sets/{setId}/submit
     */
    public function submit(Request $request, $setId)
    {
        $user = Auth::user();
        
        $validator = Validator::make($request->all(), [
            'games' => 'required|array|min:1',
            'games.*.index' => 'required|integer|min:1',
            'games.*.stage' => 'required|string',
            'games.*.winner' => 'required|in:p1,p2',
            // Stocks pueden ser desconocidas (null)
            'games.*.stocksP1' => 'nullable|integer|min:0|max:3',
            'games.*.stocksP2' => 'nullable|integer|min:0|max:3',
            // En edición, los personajes deben estar especificados
            'games.*.characterP1' => 'required|string',
            'games.*.characterP2' => 'required|string',
            'notes' => 'nullable|string|max:1000',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        try {
            // Obtener información del set desde start.gg
            $setDetail = $this->client->getSetDetail($user, $setId);
            if (($setDetail['status'] ?? null) !== 'in_progress') {
                return response()->json([
                    'error' => 'Set not in progress',
                    'message' => 'Solo se pueden enviar reportes cuando el set está en progreso.',
                ], 409);
            }

            // Evitar reportes duplicados pendientes para el mismo set
            $pending = Report::where('set_id', $setId)->where('status', 'pending')->first();
            if ($pending) {
                return response()->json([
                    'error' => 'Report already pending',
                    'message' => 'Ya existe un reporte pendiente para este set',
                    'report_id' => $pending->id,
                ], 409);
            }

            $state = SetState::where('set_id', $setId)->first();
            if ($state?->best_of) {
                $setDetail['bestOf'] = (int) $state->best_of;
            }
            
            // Validar que el usuario es uno de los participantes del set (userId o participant/entrant)
            $userStartggId = (string) $user->startgg_user_id;
            $p1Ids = array_filter([
                isset($setDetail['p1']['userId']) ? (string) $setDetail['p1']['userId'] : null,
                isset($setDetail['p1']['participantId']) ? (string) $setDetail['p1']['participantId'] : null,
                isset($setDetail['p1']['entrantId']) ? (string) $setDetail['p1']['entrantId'] : null,
            ]);
            $p2Ids = array_filter([
                isset($setDetail['p2']['userId']) ? (string) $setDetail['p2']['userId'] : null,
                isset($setDetail['p2']['participantId']) ? (string) $setDetail['p2']['participantId'] : null,
                isset($setDetail['p2']['entrantId']) ? (string) $setDetail['p2']['entrantId'] : null,
            ]);

            $isParticipant = in_array($userStartggId, $p1Ids, true) || in_array($userStartggId, $p2Ids, true);

            if (!$isParticipant) {
                Log::warning('User attempted to submit report for set they do not participate in', [
                    'user_id' => $user->id,
                    'user_startgg_id' => $userStartggId,
                    'set_id' => $setId,
                    'p1_ids' => $p1Ids,
                    'p2_ids' => $p2Ids,
                ]);
                
                return response()->json([
                    'error' => 'Unauthorized',
                    'message' => 'You can only submit reports for sets you participate in',
                ], 403);
            }
            
            // Validar games según reglas SBS
            $games = $request->input('games');
            $validationErrors = $this->validateGames($games, $setDetail['bestOf'] ?? 3);
            
            if (!empty($validationErrors)) {
                return response()->json([
                    'error' => 'Game validation failed',
                    'errors' => $validationErrors,
                ], 422);
            }

            // Calcular scores
            $scoreP1 = 0;
            $scoreP2 = 0;
            foreach ($games as $game) {
                if ($game['winner'] === 'p1') $scoreP1++;
                if ($game['winner'] === 'p2') $scoreP2++;
            }

            // Crear reporte en base de datos
            DB::beginTransaction();
            
            $report = Report::create([
                'user_id' => $user->id,
                'event_id' => $setDetail['eventId'],
                'event_name' => $setDetail['eventName'] ?? 'Unknown Event',
                'set_id' => $setId,
                'round' => $setDetail['round'],
                'best_of' => $setDetail['bestOf'] ?? 3,
                'p1_entrant_id' => $setDetail['p1']['entrantId'],
                'p1_name' => $setDetail['p1']['name'],
                'p2_entrant_id' => $setDetail['p2']['entrantId'],
                'p2_name' => $setDetail['p2']['name'],
                'score_p1' => $scoreP1,
                'score_p2' => $scoreP2,
                'status' => 'pending',
                'notes' => $request->input('notes'),
            ]);

            // Crear games asociados
            foreach ($games as $gameData) {
                Game::create([
                    'report_id' => $report->id,
                    'game_index' => $gameData['index'],
                    'stage' => $gameData['stage'],
                    'winner' => $gameData['winner'],
                    'stocks_p1' => $gameData['stocksP1'],
                    'stocks_p2' => $gameData['stocksP2'],
                    'character_p1' => $gameData['characterP1'] ?? null,
                    'character_p2' => $gameData['characterP2'] ?? null,
                ]);
            }

            DB::commit();

            $this->invalidateSetCaches($setId, $setDetail['eventId'] ?? null, $user->id);

            return response()->json([
                'message' => 'Report submitted successfully',
                'report' => $report->load('games'),
            ], 201);
            
        } catch (\Throwable $e) {
            DB::rollBack();
            
            Log::error('Error submitting set report', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);
            
            return response()->json([
                'error' => 'Failed to submit report',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Obtener estado sincronizado del set (RPS, bans, final_stage)
     * GET /api/sets/{setId}/state
     */
    public function state(Request $request, $setId)
    {
        $user = Auth::user();

        try {
            $state = SetState::firstOrCreate(
                ['set_id' => $setId],
                ['bans' => [], 'phase' => 'rps']
            );

            return response()->json($state);
        } catch (\Illuminate\Database\QueryException $ex) {
            Log::error('DB error fetching set state', ['set_id' => $setId, 'error' => $ex->getMessage()]);
            return response()->json([
                'error' => 'Error de base de datos',
                'message' => 'La tabla de estados del set no existe. Ejecuta las migraciones: php artisan migrate',
            ], 500);
        }
    }

    /**
     * Registrar elección de RPS por el jugador
     * POST /api/sets/{setId}/rps
     * body: { choice: 'rock'|'paper'|'scissors' }
     */
    public function rps(Request $request, $setId)
    {
        $user = Auth::user();

        $data = $request->validate([
            'choice' => 'required|string',
        ]);

        // Obtener set detail para saber quién es p1/p2
        try {
            $setDetail = $this->client->getSetDetail($user, $setId);
        } catch (\RuntimeException $e) {
            Log::warning('Start.gg error fetching set detail for RPS', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return StartggErrorClassifier::toJsonResponse($e->getMessage(), 'Failed to fetch set detail');
        } catch (\Throwable $e) {
            Log::error('Error fetching set detail for RPS', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => 'Failed to fetch set detail',
                'message' => $e->getMessage(),
                'code' => StartggErrorClassifier::UNKNOWN,
            ], 500);
        }

        try {
            $state = SetState::firstOrCreate(
                ['set_id' => $setId],
                ['bans' => [], 'phase' => 'rps']
            );
        } catch (\Illuminate\Database\QueryException $ex) {
            Log::error('DB error saving rps choice', ['set_id' => $setId, 'error' => $ex->getMessage()]);
            return response()->json([
                'error' => 'Error de base de datos',
                'message' => 'La tabla de estados del set no existe. Ejecuta las migraciones: php artisan migrate',
            ], 500);
        }

        if ($state->phase !== 'rps') {
            return response()->json([
                'error' => 'RPS phase not active',
                'message' => 'La fase de RPS no está activa para este set.',
            ], 422);
        }

        // Determine if user is p1 or p2 by startgg user id
        $startggId = $user->startgg_user_id ?? null;
        $role = null;
        if ($startggId && isset($setDetail['p1']) && (string)$startggId === (string)$setDetail['p1']['userId']) {
            $role = 'p1';
        } elseif ($startggId && isset($setDetail['p2']) && (string)$startggId === (string)$setDetail['p2']['userId']) {
            $role = 'p2';
        }

        if (!$role) {
            return response()->json(['error' => 'User not a participant of this set'], 403);
        }

        // Save choice
        if ($role === 'p1') {
            $state->p1_choice = $data['choice'];
        } else {
            $state->p2_choice = $data['choice'];
        }

        // If both choices set, move to banning
        if ($state->p1_choice && $state->p2_choice) {
            $state->phase = 'banning';
            $state->bans = $state->bans ?? [];
        }

        $state->save();

        return response()->json($state);
    }

    /**
     * Registrar ban de stage. Se respeta orden: p1 3 bans, p2 4 bans, p1 picks final stage among remaining.
     * POST /api/sets/{setId}/bans
     * body: { stage: 'Stage Name' }
     */
    public function ban(Request $request, $setId)
    {
        $user = Auth::user();

        $data = $request->validate([
            'stage' => 'required|string',
        ]);

        try {
            $setDetail = $this->client->getSetDetail($user, $setId);
        } catch (\RuntimeException $e) {
            Log::warning('Start.gg error fetching set detail for bans', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return StartggErrorClassifier::toJsonResponse($e->getMessage(), 'Failed to fetch set detail');
        } catch (\Throwable $e) {
            Log::error('Error fetching set detail for bans', [
                'set_id' => $setId,
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => 'Failed to fetch set detail',
                'message' => $e->getMessage(),
                'code' => StartggErrorClassifier::UNKNOWN,
            ], 500);
        }

        try {
            $state = SetState::firstOrCreate(
                ['set_id' => $setId],
                ['bans' => [], 'phase' => 'rps']
            );
        } catch (\Illuminate\Database\QueryException $ex) {
            Log::error('DB error handling ban', ['set_id' => $setId, 'error' => $ex->getMessage()]);
            return response()->json([
                'error' => 'Error de base de datos',
                'message' => 'La tabla de estados del set no existe. Ejecuta las migraciones: php artisan migrate',
            ], 500);
        }

        if ($state->phase !== 'banning') {
            return response()->json(['error' => 'Banning phase not active'], 422);
        }

        $startggId = $user->startgg_user_id ?? null;
        $role = null;
        if ($startggId && isset($setDetail['p1']) && (string)$startggId === (string)$setDetail['p1']['userId']) {
            $role = 'p1';
        } elseif ($startggId && isset($setDetail['p2']) && (string)$startggId === (string)$setDetail['p2']['userId']) {
            $role = 'p2';
        }

        if (!$role) return response()->json(['error' => 'User not a participant'], 403);

        $bans = $state->bans ?? [];

        // If final_stage already chosen, no further changes
        if ($state->final_stage) {
            return response()->json(['error' => 'Final stage already selected'], 422);
        }

        // Do not allow duplicate bans
        if (in_array($data['stage'], $bans)) {
            return response()->json(['error' => 'Stage already banned'], 422);
        }

        // Determine turn logic: p1 first 3 bans, then p2 4 bans, then p1 picks among remaining
        $totalBans = count($bans);

        if ($totalBans < 3) {
            // p1's first 3 bans
            if ($role !== 'p1') return response()->json(['error' => 'Not your turn to ban'], 403);
            $bans[] = $data['stage'];
        } elseif ($totalBans >= 3 && $totalBans < 7) {
            // p2's 4 bans
            if ($role !== 'p2') return response()->json(['error' => 'Not your turn to ban'], 403);
            $bans[] = $data['stage'];
        } elseif ($totalBans === 7) {
            // Now p1 picks final stage from remaining
            // Validate stage is not banned and belongs to remaining
            $allStages = (array) ($request->input('allStages') ?? []);
            // if allStages empty, try to use a known list from config
            $remaining = [];
            if (!empty($allStages)) {
                $remaining = array_values(array_diff($allStages, $bans));
            }
            if (!empty($remaining) && !in_array($data['stage'], $remaining)) {
                return response()->json(['error' => 'Stage not available for pick'], 422);
            }

            if ($role !== 'p1') return response()->json(['error' => 'Not your turn to pick'], 403);

            $state->final_stage = $data['stage'];
            $state->phase = 'picked';
            $state->bans = $bans;
            $state->save();

            return response()->json($state);
        } else {
            return response()->json(['error' => 'Invalid ban state'], 422);
        }

        // Save bans and remain in banning phase
        $state->bans = $bans;
        $state->save();

        return response()->json($state);
    }

    /**
     * Obtener borrador del set para el usuario
     * GET /api/sets/{setId}/draft
     */
    public function draft(Request $request, $setId)
    {
        $user = Auth::user();

        try {
            $draft = SetDraft::where('set_id', $setId)->where('user_id', $user->id)->first();
            if (!$draft) {
                return response()->json(null);
            }
            return response()->json($draft);
        } catch (\Throwable $e) {
            Log::error('Error fetching set draft', ['set_id' => $setId, 'user_id' => $user->id, 'error' => $e->getMessage()]);
            return response()->json(['error' => 'No se pudo obtener el borrador'], 500);
        }
    }

    /**
     * Guardar/actualizar borrador del set para el usuario
     * POST /api/sets/{setId}/draft
     * body: { data: {...} }
     */
    public function saveDraft(Request $request, $setId)
    {
        $user = Auth::user();

        $payload = $request->validate([
            'data' => 'required|array',
        ]);

        try {
            $draft = SetDraft::updateOrCreate(
                ['set_id' => $setId, 'user_id' => $user->id],
                ['data' => $payload['data'], 'status' => 'draft']
            );

            $this->invalidateSetCaches($setId);

            return response()->json($draft);
        } catch (\Throwable $e) {
            Log::error('Error saving set draft', ['set_id' => $setId, 'user_id' => $user->id, 'error' => $e->getMessage()]);
            return response()->json(['error' => 'No se pudo guardar el borrador'], 500);
        }
    }

    /**
     * Validar games según reglas SBS
     */
    private function validateGames(array $games, int $bestOf): array
    {
        $errors = [];
        $validStages = [
            'Battlefield',
            'Small Battlefield',
            'Final Destination',
            'Smashville',
            'Pokemon Stadium 2',
            'Town and City',
            "Yoshi's Story",
            'Hollow Bastion',
            'Kalos Pokemon League',
        ];

        // Validar número de games
        $gamesNeeded = (int) ceil($bestOf / 2);
        $scoreP1 = 0;
        $scoreP2 = 0;
        
        foreach ($games as $index => $game) {
            // Validar stage
            if (!in_array($game['stage'], $validStages)) {
                $errors[] = "Game {$game['index']}: Invalid stage '{$game['stage']}'";
            }

            // Validar personajes requeridos
            if (empty($game['characterP1']) || empty($game['characterP2'])) {
                $errors[] = "Game {$game['index']}: Missing character selection";
            }

            // Validar stocks según ganador (si se proporcionan; pueden ser desconocidos)
            if ($game['winner'] === 'p1') {
                $scoreP1++;
                if ($game['stocksP1'] !== null || $game['stocksP2'] !== null) {
                    if ($game['stocksP2'] !== 0) {
                        $errors[] = "Game {$game['index']}: P2 must have 0 stocks when P1 wins";
                    }
                    if ($game['stocksP1'] < 1 || $game['stocksP1'] > 3) {
                        $errors[] = "Game {$game['index']}: P1 stocks must be between 1-3";
                    }
                }
            } elseif ($game['winner'] === 'p2') {
                $scoreP2++;
                if ($game['stocksP1'] !== null || $game['stocksP2'] !== null) {
                    if ($game['stocksP1'] !== 0) {
                        $errors[] = "Game {$game['index']}: P1 must have 0 stocks when P2 wins";
                    }
                    if ($game['stocksP2'] < 1 || $game['stocksP2'] > 3) {
                        $errors[] = "Game {$game['index']}: P2 stocks must be between 1-3";
                    }
                }
            }
        }

        // Validar que haya un ganador del set
        if ($scoreP1 < $gamesNeeded && $scoreP2 < $gamesNeeded) {
            $errors[] = "Not enough games won. Best of {$bestOf} requires {$gamesNeeded} wins";
        }

        // No puede haber más games de los necesarios
        if (count($games) > $bestOf) {
            $errors[] = "Too many games. Best of {$bestOf} allows maximum {$bestOf} games";
        }

        return $errors;
    }

    /**
     * Vista en vivo para espectadores (solo lectura, polling cacheado).
     * GET /api/sets/{setId}/spectate
     *
     * - Metadata de start.gg cacheada 10 min (nombres, ronda).
     * - Progreso en vivo desde BD local cacheado 5 s (compartido entre viewers).
     * - Sin llamadas a start.gg en el camino caliente del polling.
     */
    public function spectate(Request $request, $setId)
    {
        $user = Auth::user();
        $cacheKey = "set_spectate_{$setId}";

        try {
            $payload = Cache::remember($cacheKey, now()->addSeconds(5), function () use ($user, $setId) {
                $meta = Cache::remember(
                    "set_spectate_meta_{$setId}",
                    now()->addMinutes(10),
                    fn () => $this->client->getSetDetail($user, $setId)
                );

                $status = $meta['status'] ?? 'not_started';
                if ($status !== 'in_progress') {
                    return [
                        'available' => false,
                        'reason' => $status === 'not_started' ? 'not_started' : 'finished',
                        'setDetail' => $this->spectateSetDetail($meta),
                    ];
                }

                $state = SetState::where('set_id', $setId)->first();
                $bestOf = (int) ($state?->best_of ?: ($meta['bestOf'] ?? 3));

                $latestDraft = SetDraft::where('set_id', $setId)
                    ->orderBy('updated_at', 'desc')
                    ->first();

                $draftData = $latestDraft?->data;
                $games = is_array($draftData['games'] ?? null) ? $draftData['games'] : [];
                $score = $this->calculateScoreFromGames($games);
                $phase = $this->deriveSpectatePhase($draftData, $games, $bestOf, $score);

                return [
                    'available' => true,
                    'setDetail' => array_merge($this->spectateSetDetail($meta), ['bestOf' => $bestOf]),
                    'draft' => $draftData,
                    'phase' => $phase,
                    'score' => $score,
                    'lastUpdate' => $latestDraft?->updated_at?->toIso8601String(),
                    'cachedAt' => now()->toIso8601String(),
                ];
            });

            if (!($payload['available'] ?? true)) {
                return response()->json($payload, 409);
            }

            return response()->json($payload);
        } catch (\Throwable $e) {
            Log::error('Error fetching spectate state', [
                'set_id' => $setId,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => 'Failed to fetch spectate state',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    private function spectateSetDetail(array $meta): array
    {
        return [
            'id' => $meta['id'],
            'eventId' => $meta['eventId'] ?? null,
            'eventName' => $meta['eventName'] ?? null,
            'round' => $meta['round'] ?? null,
            'bestOf' => (int) ($meta['bestOf'] ?? 3),
            'status' => $meta['status'] ?? null,
            'p1' => $meta['p1'] ?? null,
            'p2' => $meta['p2'] ?? null,
        ];
    }

    private function calculateScoreFromGames(array $games): array
    {
        $p1 = 0;
        $p2 = 0;
        foreach ($games as $game) {
            if (($game['winner'] ?? null) === 'p1') {
                $p1++;
            } elseif (($game['winner'] ?? null) === 'p2') {
                $p2++;
            }
        }

        return ['p1' => $p1, 'p2' => $p2];
    }

    private function deriveSpectatePhase(?array $draft, array $games, int $bestOf, array $score): string
    {
        if (!$draft) {
            return 'waiting';
        }

        if (empty($draft['rpsWinner'])) {
            return 'rps';
        }

        $current = !empty($games) ? $games[count($games) - 1] : null;
        if ($current && empty($current['stage'])) {
            return 'bans';
        }

        $gamesNeeded = (int) ceil($bestOf / 2);
        if ($score['p1'] >= $gamesNeeded || $score['p2'] >= $gamesNeeded) {
            return 'submit';
        }

        return 'games';
    }

    private function forgetSpectateCache(string|int $setId): void
    {
        $this->invalidateSetCaches($setId);
    }

    /**
     * Obtener estado en vivo del set para admin (incluyendo borradores)
     * GET /api/admin/sets/{setId}/live
     */
    public function adminLiveState(Request $request, $setId)
    {
        $user = Auth::user();

        // 1. Obtener detalles básicos de start.gg
        try {
            $setDetail = $this->client->getSetDetail($user, $setId);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to fetch set detail from start.gg', 'message' => $e->getMessage()], 500);
        }

        // 2. Obtener estado oficial (RPS/Bans/BestOf)
        $state = SetState::where('set_id', $setId)->first();
        if ($state?->best_of) {
            $setDetail['bestOf'] = (int) $state->best_of;
        }

        // 3. Obtener el borrador más reciente (de CUALQUIER usuario para este set)
        // Esto permite al admin ver lo último que se ha modificado
        $latestDraft = SetDraft::where('set_id', $setId)
            ->orderBy('updated_at', 'desc')
            ->first();

        // Estructurar respuesta combinada
        $liveState = [
            'setDetail' => $setDetail,
            'state' => $state,
            'draft' => $latestDraft ? $latestDraft->data : null,
            'lastUpdate' => $latestDraft ? $latestDraft->updated_at->toIso8601String() : null,
        ];

        return response()->json($liveState);
    }

    /**
     * Reiniciar un set: borrar reportes, borradores y estado interno.
     * POST /api/admin/sets/{setId}/reset
     */
    public function resetSet(Request $request, $setId)
    {
        $user = Auth::user();

        // 1. Intentar reiniciar el set en start.gg para que vuelva a estado
        // inicial (not_started). Esto permite re-iniciarlo y re-especificar el
        // Best Of. Si falla (p.ej. set "preview" todavía no creado en start.gg),
        // continuamos con el reinicio local para no dejar datos inconsistentes.
        $startggReset = false;
        $startggError = null;
        try {
            $this->client->resetSet($user, $setId);
            $startggReset = true;
        } catch (\Throwable $e) {
            $startggError = $e->getMessage();
            Log::warning('startgg reset failed during set reset, continuing with local reset', [
                'set_id' => $setId,
                'admin_id' => $user->id,
                'error' => $startggError,
            ]);
        }

        try {
            DB::beginTransaction();

            $eventId = $request->input('eventId') ?? Report::where('set_id', $setId)->value('event_id');

            // Borrar reportes (cascade borra games asociados)
            Report::where('set_id', $setId)->delete();

            // Borrar borradores
            SetDraft::where('set_id', $setId)->delete();

            // Resetear estado del set (RPS/bans/best_of)
            SetState::where('set_id', $setId)->delete();

            DB::commit();

            $this->invalidateSetCaches($setId, $eventId, $user->id, false);

            Log::info('Set reset by admin', [
                'set_id' => $setId,
                'admin_id' => $user->id,
                'startgg_reset' => $startggReset,
            ]);

            return response()->json([
                'message' => $startggReset
                    ? 'Set reiniciado correctamente en start.gg. Vuelve a iniciarlo para definir el Best Of.'
                    : 'Set reiniciado localmente, pero no se pudo reiniciar en start.gg.',
                'startggReset' => $startggReset,
                'startggError' => $startggReset ? null : $startggError,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();

            Log::error('Error resetting set', [
                'set_id' => $setId,
                'admin_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => 'Failed to reset set',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Cambiar el Best Of de un set en progreso sin perder el progreso reportado.
     * El Best Of es un concepto local (start.gg solo cuenta games ganados), así
     * que basta con actualizar el estado interno del set.
     * POST /api/admin/sets/{setId}/best-of
     */
    public function setBestOf(Request $request, $setId)
    {
        $user = Auth::user();

        $validator = Validator::make($request->all(), [
            'bestOf' => 'required|integer|in:3,5',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors(),
            ], 422);
        }

        $bestOf = (int) $request->input('bestOf');

        try {
            $state = SetState::firstOrNew(['set_id' => $setId]);
            $state->best_of = $bestOf;
            $state->save();

            Cache::forget("set_detail_{$setId}");
            $this->invalidateSetCaches($setId);

            Log::info('Set best_of changed by admin', [
                'set_id' => $setId,
                'admin_id' => $user->id,
                'best_of' => $bestOf,
            ]);

            return response()->json([
                'message' => "Best Of actualizado a BO{$bestOf}",
                'bestOf' => $bestOf,
            ]);
        } catch (\Throwable $e) {
            Log::error('Error changing set best_of', [
                'set_id' => $setId,
                'admin_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => 'Failed to change best of',
                'message' => $e->getMessage(),
            ], 500);
        }
    }
}

