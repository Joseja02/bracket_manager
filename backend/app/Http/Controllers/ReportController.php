<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Models\Report;
use App\Models\Game;
use App\Services\StartggClient;
use App\Services\StartggAppClient;
use App\Services\StartggErrorClassifier;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    use \App\Http\Concerns\ChecksEventAdmin;
    use \App\Http\Concerns\InvalidatesSetCaches;

    public function __construct(private StartggClient $client, private StartggAppClient $appClient) {}

    /**
     * GET /api/admin/reports
     * eventId is optional. Without it, only reports from events administered
     * by the current user are returned.
     */
    public function index(Request $request)
    {
        $user = Auth::user();
        $eventId = $request->query('eventId');

        $query = Report::with(['user', 'games'])->orderBy('created_at', 'desc');

        if ($eventId) {
            if (!$this->isEventAdmin($user, $eventId)) {
                return response()->json(['error' => 'Forbidden. Not an admin of this event.'], 403);
            }
            $query->where('event_id', $eventId);
        } else {
            $eventQuery = Report::query();
            if ($request->has('status')) {
                $eventQuery->where('status', $request->input('status'));
            }

            $authorizedEventIds = $eventQuery
                ->distinct()
                ->pluck('event_id')
                ->filter(fn ($candidateEventId) => $this->isEventAdmin($user, $candidateEventId))
                ->values()
                ->all();

            $query->whereIn('event_id', $authorizedEventIds);
        }

        // Filtrar por estado
        if ($request->has('status')) {
            $query->where('status', $request->input('status'));
        }

        $reports = $query->get()->map(function ($report) {
            return [
                'id' => $report->id,
                'eventId' => $report->event_id,
                'eventName' => $report->event_name,
                'setId' => $report->set_id,
                'round' => $report->round,
                'p1' => [
                    'entrantId' => $report->p1_entrant_id,
                    'name' => $report->p1_name,
                ],
                'p2' => [
                    'entrantId' => $report->p2_entrant_id,
                    'name' => $report->p2_name,
                ],
                'scoreP1' => $report->score_p1,
                'scoreP2' => $report->score_p2,
                'status' => $report->status,
                'submittedBy' => $report->user->name,
                'createdAt' => $report->created_at->toIso8601String(),
            ];
        });

        return response()->json($reports);
    }

    /**
     * Obtener detalle de un reporte (admin)
     * GET /api/admin/reports/{reportId}
     */
    public function show($reportId)
    {
        $report = Report::with(['user', 'games'])->findOrFail($reportId);
        $user = Auth::user();
        if (!$this->isEventAdmin($user, $report->event_id)) {
            return response()->json(['error' => 'Forbidden. Not an admin of this event.'], 403);
        }

        $reportDetail = [
            'id' => $report->id,
            'eventId' => $report->event_id,
            'eventName' => $report->event_name,
            'setId' => $report->set_id,
            'round' => $report->round,
            'bestOf' => $report->best_of,
            'p1' => [
                'entrantId' => $report->p1_entrant_id,
                'name' => $report->p1_name,
            ],
            'p2' => [
                'entrantId' => $report->p2_entrant_id,
                'name' => $report->p2_name,
            ],
            'scoreP1' => $report->score_p1,
            'scoreP2' => $report->score_p2,
            'status' => $report->status,
            'submittedBy' => $report->user->name,
            'createdAt' => $report->created_at->toIso8601String(),
            'notes' => $report->notes,
            'rejectionReason' => $report->rejection_reason,
            'games' => $report->games->map(function ($game) {
                return [
                    'index' => $game->game_index,
                    'stage' => $game->stage,
                    'winner' => $game->winner,
                    'stocksP1' => $game->stocks_p1,
                    'stocksP2' => $game->stocks_p2,
                    'characterP1' => $game->character_p1,
                    'characterP2' => $game->character_p2,
                ];
            }),
        ];

        return response()->json($reportDetail);
    }

    /**
     * Actualizar un reporte (admin) para corregir games antes de aprobar
     * PUT /api/admin/reports/{reportId}
     */
    public function update(Request $request, $reportId)
    {
        $report = Report::with('games')->findOrFail($reportId);
        $user = Auth::user();
        if (!$this->isEventAdmin($user, $report->event_id)) {
            return response()->json(['error' => 'Forbidden. Not an admin of this event.'], 403);
        }

        // Permitir editar reportes pending o rejected (admin puede arreglar y reenviar)
        if (!in_array($report->status, ['pending', 'rejected'], true)) {
            return response()->json(['error' => 'Report is not editable'], 400);
        }

        $payload = $request->validate([
            'games' => 'required|array|min:1',
            'games.*.index' => 'required|integer|min:1',
            'games.*.stage' => 'required|string',
            'games.*.winner' => 'required|in:p1,p2',
            'games.*.stocksP1' => 'nullable|integer|min:0|max:3',
            'games.*.stocksP2' => 'nullable|integer|min:0|max:3',
            'games.*.characterP1' => 'required|string',
            'games.*.characterP2' => 'required|string',
            'notes' => 'nullable|string|max:1000',
        ]);

        $games = $payload['games'];
        $scoreP1 = 0;
        $scoreP2 = 0;
        foreach ($games as $g) {
            if (($g['winner'] ?? null) === 'p1') $scoreP1++;
            if (($g['winner'] ?? null) === 'p2') $scoreP2++;
        }

        DB::beginTransaction();
        try {
            $report->score_p1 = $scoreP1;
            $report->score_p2 = $scoreP2;
            $report->notes = $payload['notes'] ?? $report->notes;
            $report->status = 'pending';
            $report->rejection_reason = null;
            $report->save();

            // Reemplazar games
            $report->games()->delete();
            foreach ($games as $gameData) {
                Game::create([
                    'report_id' => $report->id,
                    'game_index' => $gameData['index'],
                    'stage' => $gameData['stage'],
                    'winner' => $gameData['winner'],
                    'stocks_p1' => $gameData['stocksP1'] ?? null,
                    'stocks_p2' => $gameData['stocksP2'] ?? null,
                    'character_p1' => $gameData['characterP1'],
                    'character_p2' => $gameData['characterP2'],
                ]);
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('Error updating report', ['report_id' => $reportId, 'error' => $e->getMessage()]);
            return response()->json(['error' => 'Failed to update report', 'message' => $e->getMessage()], 500);
        }

        return $this->show($report->id);
    }

    /**
     * Aprobar un reporte (admin)
     * POST /api/admin/reports/{reportId}/approve
     */
    public function approve(Request $request, $reportId)
    {
        $user = Auth::user();
        $report = Report::with('games')->findOrFail($reportId);
        if (!$this->isEventAdmin($user, $report->event_id)) {
            return response()->json(['error' => 'Forbidden. Not an admin of this event.'], 403);
        }

        if ($report->status !== 'pending') {
            return response()->json([
                'error' => 'Report is not pending',
            ], 400);
        }

        try {
            // Reportar el set a start.gg
            $winnerId = $report->score_p1 > $report->score_p2 
                ? $report->p1_entrant_id 
                : $report->p2_entrant_id;

            // Llamar a start.gg API para reportar el set
            $this->client->reportSet(
                $user,
                $report->set_id,
                $winnerId,
                $report
            );

            // Marcar como aprobado
            $report->approve();

            $this->invalidateSetCaches($report->set_id, $report->event_id, $user->id);

            return response()->json([
                'message' => 'Report approved and submitted to start.gg',
                'report' => $report,
            ]);
            
        } catch (\RuntimeException $e) {
            $errorMessage = $e->getMessage();

            Log::error('Error approving report', [
                'report_id' => $reportId,
                'error' => $errorMessage,
            ]);

            return StartggErrorClassifier::toJsonResponse($errorMessage, 'Failed to approve report');
        } catch (\Throwable $e) {
            $errorMessage = $e->getMessage();
            
            Log::error('Error approving report', [
                'report_id' => $reportId,
                'error' => $errorMessage,
            ]);
            
            return response()->json([
                'error' => 'Failed to approve report',
                'message' => $errorMessage,
                'code' => StartggErrorClassifier::UNKNOWN,
            ], 500);
        }
    }

    /**
     * Rechazar un reporte (admin)
     * POST /api/admin/reports/{reportId}/reject
     */
    public function reject(Request $request, $reportId)
    {
        $request->validate([
            'reason' => 'required|string|max:500',
        ]);

        $report = Report::findOrFail($reportId);
        $user = Auth::user();
        if (!$this->isEventAdmin($user, $report->event_id)) {
            return response()->json(['error' => 'Forbidden. Not an admin of this event.'], 403);
        }

        if ($report->status !== 'pending') {
            return response()->json([
                'error' => 'Report is not pending',
            ], 400);
        }

        $report->reject($request->input('reason'));

        $this->invalidateSetCaches($report->set_id, $report->event_id, $user->id);

        return response()->json([
            'message' => 'Report rejected',
            'report' => $report,
        ]);
    }
}

