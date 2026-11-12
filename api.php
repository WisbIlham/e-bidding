<?php
/* eBid Majlis API: live hall auction. The admin keys in every bid; guests only watch.
 *
 * Data lives OUTSIDE the deploy folder so RunCloud atomic deploys never wipe it:
 *   DATA_DIR/state.json   full state, incl. bidder phone numbers (admin only)
 *   DATA_DIR/pin.txt      admin PIN (a random 6-digit PIN is created on first run)
 *   DATA_DIR/backups/     copy of the state before every reset
 * DATA_DIR = env EBID_DATA, else /home/<user>/ebid-data when PHP may use it, else ./.data
 * (hidden folder in the web app; nginx blocks dot-folders). Deploys must not delete .data.
 *
 * GET  api.php?v=<version>            -> { ok, same:true } when unchanged, else { ok, state } (public, no phones)
 * POST api.php {action,...}  X-Pin    -> admin actions, returns { ok, state } with phones
 */
declare(strict_types=1);

function dataDir(): string {
  $env = getenv('EBID_DATA');
  if ($env) return rtrim($env, '/');
  // Prefer /home/<user>/ebid-data, but RunCloud's open_basedir usually limits PHP to the web app
  // folder, so fall back to a hidden .data folder inside it (nginx answers 403 for dot-folders).
  if (preg_match('#^(/home/[^/]+)/#', __DIR__, $m) && @is_dir($m[1] . '/ebid-data') && @is_writable($m[1] . '/ebid-data')) return $m[1] . '/ebid-data';
  return __DIR__ . '/.data';
}
$DATA_DIR = dataDir();
$STATE_FILE = $DATA_DIR . '/state.json';
$PIN_FILE = $DATA_DIR . '/pin.txt';
if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0700, true);
if (!is_file($DATA_DIR . '/.htaccess')) @file_put_contents($DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
if (!is_file($PIN_FILE)) { @file_put_contents($PIN_FILE, (string) random_int(100000, 999999) . "\n"); @chmod($PIN_FILE, 0600); }

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Robots-Tag: noindex');

function out(array $o, int $code = 200): void { http_response_code($code); echo json_encode($o, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $msg, int $code = 400): void { out(['ok' => false, 'error' => $msg], $code); }

function seed(): array {
  return [
    'version' => 0,
    'status' => 'draft',              // draft -> open -> closed
    'startPrice' => 30000,
    'increment' => 0,                 // 0 = no fixed step: any amount above the current highest
    'bids' => [],                     // [{id,name,phone,amount,at}]
    'winner' => null,                 // {name,amount,phone,at}
    'paid' => null,                   // {at,ref}
    'payment' => ['bank' => '', 'accName' => '', 'accNo' => '', 'note' => ''],
    'openedAt' => null, 'closedAt' => null, 'updatedAt' => time(),
  ];
}
function minNext(array $s): int {
  $n = count($s['bids']);
  return $n ? (int) $s['bids'][$n - 1]['amount'] + max(1, (int) $s['increment']) : (int) $s['startPrice'];
}
function view(array $s, bool $admin): array {
  $p = $s;
  if (!$admin) {
    $p['bids'] = array_map(fn($b) => ['id' => $b['id'], 'name' => $b['name'], 'amount' => $b['amount'], 'at' => $b['at']], $s['bids']);
    if ($p['winner']) unset($p['winner']['phone']);
    if ($p['paid']) $p['paid'] = ['at' => $p['paid']['at']];
  }
  $p['minNext'] = minNext($s);
  $p['serverTime'] = time();
  return $p;
}

$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$fh = @fopen($STATE_FILE, 'c+');
if (!$fh) fail('Tidak dapat membuka fail data di server.', 500);
flock($fh, $isPost ? LOCK_EX : LOCK_SH);
$raw = stream_get_contents($fh);
$state = $raw ? json_decode($raw, true) : null;
if (!is_array($state)) $state = seed();

if (!$isPost) {
  flock($fh, LOCK_UN);
  if (isset($_GET['v']) && (int) $_GET['v'] === (int) $state['version'] && $raw) out(['ok' => true, 'same' => true, 'version' => $state['version']]);
  out(['ok' => true, 'state' => view($state, false)]);
}

// ---- admin auth ----
$pin = trim((string) @file_get_contents($PIN_FILE));
$given = trim((string) ($_SERVER['HTTP_X_PIN'] ?? ''));
if ($pin === '' || $given === '' || !hash_equals($pin, $given)) { flock($fh, LOCK_UN); sleep(2); fail('PIN salah.', 401); }

$in = (json_decode((string) file_get_contents('php://input'), true) ?: []);
$action = (string) ($in['action'] ?? '');
$S = $state;

switch ($action) {
  case 'login':
    flock($fh, LOCK_UN);
    out(['ok' => true, 'state' => view($S, true)]);

  case 'open':
    if ($S['status'] === 'closed') fail('Bidaan sudah ditutup. Guna "Buka semula" jika perlu.');
    $S['status'] = 'open'; $S['openedAt'] = $S['openedAt'] ?: time();
    break;

  case 'bid':
    if ($S['status'] !== 'open') fail('Bidaan belum dibuka atau sudah ditutup.');
    $name = trim((string) preg_replace('/\s+/u', ' ', (string) ($in['name'] ?? '')));
    $phone = trim((string) preg_replace('/[^0-9+\- ]/', '', (string) ($in['phone'] ?? '')));
    $amount = (int) round((float) ($in['amount'] ?? 0));
    if ($name === '' || mb_strlen($name) > 60) fail('Masukkan nama pembida (maksimum 60 aksara).');
    $min = minNext($S);
    if ($amount < $min) fail($S['bids']
      ? 'Jumlah mesti lebih tinggi daripada bidaan semasa RM' . number_format((int) $S['bids'][count($S['bids']) - 1]['amount']) . '. Mungkin ada bidaan baharu, semak senarai.'
      : 'Bidaan pertama mesti sekurang-kurangnya harga mula RM' . number_format((int) $S['startPrice']) . '.');
    if ($amount > 50000000) fail('Jumlah terlalu besar. Semak semula.');
    $S['bids'][] = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'phone' => mb_substr($phone, 0, 20), 'amount' => $amount, 'at' => time()];
    break;

  case 'undo':
    if ($S['status'] !== 'open') fail('Bidaan hanya boleh dibatalkan semasa bidaan dibuka.');
    if (!$S['bids']) fail('Tiada bidaan untuk dibatalkan.');
    $last = $S['bids'][count($S['bids']) - 1];
    if (!empty($in['id']) && $in['id'] !== $last['id']) fail('Bidaan terakhir sudah berubah. Semak senarai semula.');
    array_pop($S['bids']);
    break;

  case 'close':
    if ($S['status'] !== 'open') fail('Bidaan tidak dibuka.');
    $S['status'] = 'closed'; $S['closedAt'] = time();
    $last = $S['bids'] ? $S['bids'][count($S['bids']) - 1] : null;
    $S['winner'] = $last ? ['name' => $last['name'], 'amount' => $last['amount'], 'phone' => $last['phone'], 'at' => time()] : null;
    break;

  case 'reopen':
    if ($S['status'] !== 'closed') fail('Bidaan belum ditutup.');
    if ($S['paid']) fail('Bayaran sudah disahkan. Batalkan pengesahan bayaran dahulu.');
    $S['status'] = 'open'; $S['winner'] = null; $S['closedAt'] = null;
    break;

  case 'paid':
    if (!$S['winner']) fail('Belum ada pemenang.');
    $S['paid'] = ['at' => time(), 'ref' => mb_substr(trim((string) ($in['ref'] ?? '')), 0, 80)];
    break;

  case 'unpaid':
    $S['paid'] = null;
    break;

  case 'settings':
    $sp = (int) ($in['startPrice'] ?? $S['startPrice']);
    $inc = (int) ($in['increment'] ?? $S['increment']);
    if (($sp !== (int) $S['startPrice'] || $inc !== (int) $S['increment']) && $S['bids']) fail('Harga mula dan kenaikan tidak boleh diubah selepas ada bidaan.');
    if ($sp < 1 || $inc < 0) fail('Harga mula mesti lebih daripada 0, dan kenaikan tidak boleh negatif.');
    $S['startPrice'] = $sp; $S['increment'] = $inc;
    foreach (['bank', 'accName', 'accNo', 'note'] as $k) {
      if (array_key_exists($k, $in)) $S['payment'][$k] = mb_substr(trim((string) $in[$k]), 0, 160);
    }
    break;

  case 'reset':
    if (($in['confirm'] ?? '') !== 'RESET') fail('Taip RESET untuk sahkan.');
    @mkdir($DATA_DIR . '/backups', 0700, true);
    @file_put_contents($DATA_DIR . '/backups/state-' . date('Ymd-His') . '.json', json_encode($S, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    $keep = $S['payment']; $v = $S['version']; $sp = $S['startPrice']; $inc = $S['increment'];
    $S = seed(); $S['payment'] = $keep; $S['version'] = $v; $S['startPrice'] = $sp; $S['increment'] = $inc;
    break;

  default:
    fail('Tindakan tidak dikenali.');
}

$S['version'] = (int) $S['version'] + 1;
$S['updatedAt'] = time();
ftruncate($fh, 0); rewind($fh);
fwrite($fh, json_encode($S, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fflush($fh);
flock($fh, LOCK_UN);
out(['ok' => true, 'state' => view($S, true)]);
