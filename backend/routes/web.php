<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Log;
use App\Http\Controllers\StartggController;

Route::get('/', function () {
    return view('welcome');
});

// OAuth StartGG (rutas web con sesión/cookies)
Route::get('/auth/login', [StartggController::class, 'login']);
Route::get('/auth/callback', [StartggController::class, 'callback']);

// Atajo de login SOLO en local: start.gg solo permite 1 redirect_uri (producción),
// así que en localhost no se puede completar OAuth. Esta ruta NO se registra en
// dev/producción (APP_ENV != local), por lo que allí ni siquiera existe.
if (app()->environment('local')) {
    Route::get('/auth/dev-login', [StartggController::class, 'devLogin']);
}

// Ruta de diagnóstico temporal (eliminar en producción)
Route::get('/auth/debug', [StartggController::class, 'debug']);

