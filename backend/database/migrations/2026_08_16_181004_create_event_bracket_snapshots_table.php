<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('event_brackets', function (Blueprint $table) {
            $table->id();
            $table->string('event_id')->unique()->comment('ID del evento en start.gg');
            $table->string('event_name')->nullable();
            $table->json('payload')->comment('Árbol EventBracket: phases → pools → sets');
            $table->timestamp('synced_at')->nullable();
            $table->foreignId('synced_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_brackets');
    }
};
