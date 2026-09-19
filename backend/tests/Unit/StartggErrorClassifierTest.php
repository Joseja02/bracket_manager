<?php

namespace Tests\Unit;

use App\Services\StartggErrorClassifier;
use Tests\TestCase;

class StartggErrorClassifierTest extends TestCase
{
    public function test_classifies_missing_scope(): void
    {
        $code = StartggErrorClassifier::classify('Missing the following scopes: tournament.reporter');
        $this->assertSame(StartggErrorClassifier::MISSING_SCOPE, $code);
        $this->assertSame(403, StartggErrorClassifier::httpStatus($code));
    }

    public function test_classifies_invalid_token(): void
    {
        $code = StartggErrorClassifier::classify('No valid access token available. Please re-authenticate.');
        $this->assertSame(StartggErrorClassifier::INVALID_TOKEN, $code);
        $this->assertSame(401, StartggErrorClassifier::httpStatus($code));
    }

    public function test_classifies_access_denied(): void
    {
        $code = StartggErrorClassifier::classify('Access denied for this resource');
        $this->assertSame(StartggErrorClassifier::ACCESS_DENIED, $code);
        $this->assertSame(403, StartggErrorClassifier::httpStatus($code));
    }

    public function test_classifies_tournament_mismatch(): void
    {
        $code = StartggErrorClassifier::classify('Tournament mismatch: set does not belong to this tournament');
        $this->assertSame(StartggErrorClassifier::TOURNAMENT_MISMATCH, $code);
        $this->assertSame(409, StartggErrorClassifier::httpStatus($code));
    }

    public function test_json_response_includes_reauth_for_scope(): void
    {
        $response = StartggErrorClassifier::toJsonResponse(
            'Missing the following scopes: tournament.reporter',
            'Failed to start set'
        );

        $this->assertSame(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertSame('missing_scope', $data['code']);
        $this->assertSame('reauthenticate', $data['action']);
        $this->assertArrayHasKey('reauth_url', $data);
    }
}
