<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\MeController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\SetController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\DebugController;

Route::get('/ping', fn() => response()->json(['ok' => true]));

// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    // Usuario actual
    Route::get('/me', [MeController::class, 'me']);
    Route::get('/me/events', [MeController::class, 'events']);

    // Auth
    Route::post('/auth/refresh', [AuthController::class, 'refresh']);

    // Eventos
    Route::get('/events/{eventId}', [EventController::class, 'show']);
    Route::get('/events/{eventId}/admin-check', [EventController::class, 'adminCheck']);
    Route::get('/events/{eventId}/sets', [EventController::class, 'getSets']);

    // Sets
    Route::get('/sets/{setId}', [SetController::class, 'show']);
    Route::post('/sets/{setId}/start', [SetController::class, 'start']);
    Route::post('/sets/{setId}/submit', [SetController::class, 'submit']);
    Route::get('/sets/{setId}/state', [SetController::class, 'state']);
    Route::post('/sets/{setId}/rps', [SetController::class, 'rps']);
    Route::post('/sets/{setId}/bans', [SetController::class, 'ban']);
    Route::get('/sets/{setId}/draft', [SetController::class, 'draft']);
    Route::post('/sets/{setId}/draft', [SetController::class, 'saveDraft']);
    Route::get('/sets/{setId}/spectate', [SetController::class, 'spectate'])
        ->middleware('throttle:120,1');

    // Admin - Reportes
    Route::prefix('admin')->middleware('admin')->group(function () {
        Route::get('/reports', [ReportController::class, 'index']);
        Route::get('/reports/{reportId}', [ReportController::class, 'show']);
        Route::put('/reports/{reportId}', [ReportController::class, 'update']);
        Route::post('/reports/{reportId}/approve', [ReportController::class, 'approve']);
        Route::post('/reports/{reportId}/reject', [ReportController::class, 'reject']);

        // Vista en Vivo para Admins
        Route::get('/sets/{setId}/live', [SetController::class, 'adminLiveState']);
        // Reiniciar set (borrar reportes, borradores, estado + reset en start.gg)
        Route::post('/sets/{setId}/reset', [SetController::class, 'resetSet']);
        // Cambiar el Best Of de un set en progreso sin perder el progreso
        Route::post('/sets/{setId}/best-of', [SetController::class, 'setBestOf']);
    });
});

