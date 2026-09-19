<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('event_brackets');
    }

    public function down(): void
    {
        Schema::create('event_brackets', function (Blueprint $table) {
            $table->id();
            $table->string('event_id')->unique();
            $table->string('event_name')->nullable();
            $table->json('payload');
            $table->timestamp('synced_at')->nullable();
            $table->unsignedBigInteger('synced_by')->nullable();
            $table->timestamps();
        });
    }
};
