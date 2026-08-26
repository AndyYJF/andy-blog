<?php
use Typecho\Widget;
use Widget\ActionInterface;
use Widget\User;
use Widget\Security;

/**
 * Administrator-only proxy for rebuild-api /status.
 * The browser never talks to rebuild-api.
 */
class AutoRebuild_Action extends Widget implements ActionInterface
{
    public function action()
    {
        $user = User::alloc();
        if (!$user->hasLogin() || !$user->pass('administrator', true)) {
            $this->response->setStatus(403);
            $this->response->throwJson(['error' => 'forbidden']);
        }
        if (!$this->request->isPost()) {
            $this->response->setStatus(405);
            $this->response->throwJson(['error' => 'method']);
        }
        Security::alloc()->protect();

        $secretFile = getenv('WEBHOOK_SECRET_FILE') ?: __TYPECHO_ROOT_DIR__ . '/usr/.secrets/webhook_secret';
        if (!is_readable($secretFile)) {
            $this->response->setStatus(503);
            $this->response->throwJson(['error' => 'secret-unreadable']);
        }
        $secret = trim((string) file_get_contents($secretFile));
        if ($secret === '') {
            $this->response->setStatus(503);
            $this->response->throwJson(['error' => 'secret-empty']);
        }

        $endpoint = getenv('AUTO_REBUILD_STATUS_ENDPOINT') ?: 'http://rebuild-api:9000/status';
        if ($endpoint !== 'http://rebuild-api:9000/status') {
            $this->response->setStatus(500);
            $this->response->throwJson(['error' => 'endpoint']);
        }

        $ts = (string) time();
        $canonical = "GET\n/status\n" . $ts;
        $sig = 'sha256=' . hash_hmac('sha256', $canonical, $secret);

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_HTTPGET => true,
            CURLOPT_HTTPHEADER => [
                'X-Timestamp: ' . $ts,
                'X-Signature: ' . $sig,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 5,
        ]);
        $result = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($result === false || $status !== 200) {
            $this->response->setStatus(502);
            $this->response->throwJson([
                'error' => 'upstream',
                'status' => $status,
                'detail' => $error !== '' ? $error : 'bad-status',
            ]);
        }
        $payload = json_decode($result, true);
        if (!is_array($payload)) {
            $this->response->setStatus(502);
            $this->response->throwJson(['error' => 'upstream-json']);
        }
        $this->response->throwJson($payload);
    }
}
