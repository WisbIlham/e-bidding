<?php
/* eBid Majlis API: live hall auction with one or more items (lots), auctioned one at a time.
 * The admin keys in every bid; guests only watch.
 *
 * Data folder (DATA_DIR): env EBID_DATA, else /home/<user>/ebid-data when PHP may use it, else ./.data
 * (hidden folder in the web app; nginx answers 403 for dot-folders). Deploys must not delete .data.
 *   state.json   full state, incl. bidder phone numbers (admin only)
 *   pin.txt      admin PIN (a random 6-digit PIN is created on first run)
 *   img/         item photos uploaded by the admin, served by GET api.php?img=<lotId>
 *   backups/     copy of the state before every reset
 *   receipts/    deposit receipts attached to online bids (admin only: GET api.php?receipt=<id> with X-Pin)
 *
 * GET  api.php?v=<version>   -> { ok, same:true } when unchanged, else { ok, state } (public, no phones)
 * GET  api.php?img=<lotId>   -> item photo
 * POST api.php {action,...}  header X-Pin -> admin actions -> { ok, state } (admin view, with phones)
 *      Item photo upload: multipart/form-data with action=uploadImage, lotId, image=<file>.
 * ONLINE BIDS (public, no PIN): POST multipart action=submitBid: name, phone, lotId, amount, receipt=<file>
 *      -> { ok, id }. Rate-limited per IP. The bid waits in a queue; it is NOT shown until the admin checks the
 *      deposit receipt and approves it (action=reviewBid {id, decision:'approve'|'reject', reason?}).
 *      The guest polls GET api.php?sub=<id> -> { ok, status:'new'|'ok'|'rejected', reason, amount, lotTitle }.
 *      Approved online bids are normal bids with online:true.
 *
 * State (public view): the ACTIVE item's auction fields sit at the top level, so a page that only
 * knows one item keeps working: status, startPrice, increment, minNext, bids, winner, paid,
 * openedAt, closedAt. Plus: activeId, lot {id,title,desc,image,featured}, lots [summaries], payment.
 */
declare(strict_types=1);

function dataDir(): string {
  $env = getenv('EBID_DATA');
  if ($env) return rtrim($env, '/');
  if (preg_match('#^(/home/[^/]+)/#', __DIR__, $m) && @is_dir($m[1] . '/ebid-data') && @is_writable($m[1] . '/ebid-data')) return $m[1] . '/ebid-data';
  return __DIR__ . '/.data';
}
$DATA_DIR = dataDir();
$STATE_FILE = $DATA_DIR . '/state.json';
$PIN_FILE = $DATA_DIR . '/pin.txt';
$IMG_DIR = $DATA_DIR . '/img';
if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0700, true);
if (!is_file($DATA_DIR . '/.htaccess')) @file_put_contents($DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");
if (!is_file($PIN_FILE)) { @file_put_contents($PIN_FILE, (string) random_int(100000, 999999) . "\n"); @chmod($PIN_FILE, 0600); }

// ---- item photo ----
if (isset($_GET['img'])) {
  $id = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $_GET['img']);
  $f = $id !== '' ? (glob($IMG_DIR . '/' . $id . '.*')[0] ?? null) : null;
  if (!$f) { http_response_code(404); exit; }
  $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
  header('Content-Type: ' . ($types[pathinfo($f, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
  header('Cache-Control: public, max-age=86400');
  readfile($f); exit;
}

// ---- receipt file (admin only; the page fetches it with the X-Pin header and shows a blob) ----
if (isset($_GET['receipt'])) {
  $pin = trim((string) @file_get_contents($PIN_FILE));
  $given = trim((string) ($_SERVER['HTTP_X_PIN'] ?? ''));
  if ($pin === '' || $given === '' || !hash_equals($pin, $given)) { sleep(2); http_response_code(401); exit; }
  $id = preg_replace('/[^a-zA-Z0-9]/', '', (string) $_GET['receipt']);
  $f = $id !== '' ? (glob($DATA_DIR . '/receipts/' . $id . '.*')[0] ?? null) : null;
  if (!$f) { http_response_code(404); exit; }
  $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'pdf' => 'application/pdf'];
  header('Content-Type: ' . ($types[pathinfo($f, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
  header('Cache-Control: private, no-store');
  readfile($f); exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Robots-Tag: noindex');

function out(array $o, int $code = 200): void { http_response_code($code); echo json_encode($o, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $msg, int $code = 400): void { out(['ok' => false, 'error' => $msg], $code); }
function clean(string $s, int $max): string { return mb_substr(trim((string) preg_replace('/[ \t]+/u', ' ', $s)), 0, $max); }

function newLot(string $id, string $title, string $desc = '', int $startPrice = 1000, int $increment = 0, bool $featured = false): array {
  return [
    'id' => $id, 'title' => $title, 'desc' => $desc, 'image' => '', 'featured' => $featured,
    'startPrice' => $startPrice, 'increment' => $increment,      // increment 0 = any amount above the current highest
    'status' => 'draft', 'bids' => [], 'winner' => null, 'paid' => null, 'openedAt' => null, 'closedAt' => null,
  ];
}
function seed(): array {
  // 'nikaziz' is the featured item: its photos, video and story come from assets/lot.js.
  return [
    'version' => 0, 'activeId' => 'nikaziz',
    'lots' => [newLot('nikaziz', 'Baju Almarhum Tuan Guru Nik Abdul Aziz Nik Mat', '', 30000, 0, true)],
    'payment' => ['bank' => '', 'accName' => '', 'accNo' => '', 'note' => '', 'wa' => '', 'deposit' => 10, 'onlineOn' => true],   // deposit = online bid fee (RM) set by the admin
    'pending' => [],                  // online bids waiting for review: [{id,lotId,lotTitle,name,phone,amount,file,type,at,status,reason,reviewedAt}]
    'updatedAt' => time(),
  ];
}
// Older one-item state files had the auction fields at the top level.
function migrate(array $s): array {
  if (isset($s['lots'])) { $s['pending'] = $s['pending'] ?? []; $s['payment'] = ($s['payment'] ?? []) + ['bank' => '', 'accName' => '', 'accNo' => '', 'note' => '', 'wa' => '', 'deposit' => 10, 'onlineOn' => true]; return $s; }
  $n = seed();
  $lot = &$n['lots'][0];
  foreach (['status', 'startPrice', 'increment', 'bids', 'winner', 'paid', 'openedAt', 'closedAt'] as $k) if (array_key_exists($k, $s)) $lot[$k] = $s[$k];
  if (isset($s['payment'])) $n['payment'] = $s['payment'] + $n['payment'];   // keep old values, add new keys
  $n['version'] = (int) ($s['version'] ?? 0);
  return $n;
}
function minNext(array $l): int {
  $n = count($l['bids']);
  return $n ? (int) $l['bids'][$n - 1]['amount'] + max(1, (int) $l['increment']) : (int) $l['startPrice'];
}
// Online bids must beat the current highest AND every online bid still waiting for review on the same item.
function minOnline(array $s, array $l): int {
  $m = minNext($l);
  foreach ($s['pending'] ?? [] as $r) if ($r['status'] === 'new' && $r['lotId'] === $l['id']) $m = max($m, (int) $r['amount'] + max(1, (int) $l['increment']));
  return $m;
}
function lotIndex(array $s, string $id): int {
  foreach ($s['lots'] as $i => $l) if ($l['id'] === $id) return $i;
  return -1;
}
function lotPublic(array $l): array {
  $top = $l['bids'] ? $l['bids'][count($l['bids']) - 1] : null;
  return [
    'id' => $l['id'], 'title' => $l['title'], 'desc' => $l['desc'], 'image' => $l['image'], 'featured' => $l['featured'],
    'status' => $l['status'], 'startPrice' => $l['startPrice'], 'increment' => $l['increment'], 'count' => count($l['bids']),
    'top' => $top ? ['name' => $top['name'], 'amount' => $top['amount']] : null,
    'winner' => $l['winner'] ? ['name' => $l['winner']['name'], 'amount' => $l['winner']['amount']] : null,
    'paid' => (bool) $l['paid'],
  ];
}
function view(array $s, bool $admin): array {
  $i = lotIndex($s, (string) $s['activeId']);
  $a = $s['lots'][max(0, $i)];
  $bids = $admin ? $a['bids'] : array_map(fn($b) => ['id' => $b['id'], 'name' => $b['name'], 'amount' => $b['amount'], 'at' => $b['at'], 'online' => !empty($b['online'])], $a['bids']);
  $winner = $a['winner']; if ($winner && !$admin) unset($winner['phone']);
  $paid = $a['paid']; if ($paid && !$admin) $paid = ['at' => $paid['at']];
  $v = [
    'version' => $s['version'], 'activeId' => $a['id'],
    'lot' => ['id' => $a['id'], 'title' => $a['title'], 'desc' => $a['desc'], 'image' => $a['image'], 'featured' => $a['featured']],
    'status' => $a['status'], 'startPrice' => $a['startPrice'], 'increment' => $a['increment'], 'minNext' => minNext($a),
    'bids' => $bids, 'winner' => $winner, 'paid' => $paid, 'openedAt' => $a['openedAt'], 'closedAt' => $a['closedAt'],
    'lots' => $admin ? array_map(fn($l) => $l + ['minNext' => minNext($l)], $s['lots']) : array_map('lotPublic', $s['lots']),
    'payment' => $s['payment'], 'updatedAt' => $s['updatedAt'], 'serverTime' => time(),
  ];
  $v['minOnline'] = minOnline($s, $a);
  $v['pendingCount'] = count(array_filter($s['pending'] ?? [], fn($r) => $r['status'] === 'new' && $r['lotId'] === $a['id']));
  if ($admin) $v['pending'] = array_map(fn($r) => array_diff_key($r, ['file' => 1]), array_reverse($s['pending'] ?? []));
  return $v;
}

$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$fh = @fopen($STATE_FILE, 'c+');
if (!$fh) fail('Tidak dapat membuka fail data di server.', 500);
flock($fh, $isPost ? LOCK_EX : LOCK_SH);
$raw = stream_get_contents($fh);
$state = $raw ? json_decode($raw, true) : null;
$state = is_array($state) ? migrate($state) : seed();

if (!$isPost && isset($_GET['sub'])) {   // a guest checks their own online bid (the id is the secret)
  flock($fh, LOCK_UN);
  foreach ($state['pending'] as $r) if ($r['id'] === (string) $_GET['sub'])
    out(['ok' => true, 'status' => $r['status'], 'reason' => $r['reason'] ?? '', 'amount' => $r['amount'], 'lotTitle' => $r['lotTitle'], 'at' => $r['at']]);
  fail('Tidak dijumpai.', 404);
}
if (!$isPost) {
  flock($fh, LOCK_UN);
  if (isset($_GET['v']) && (int) $_GET['v'] === (int) $state['version'] && $raw) out(['ok' => true, 'same' => true, 'version' => $state['version']]);
  out(['ok' => true, 'state' => view($state, false)]);
}

// A multipart request bigger than post_max_size arrives with no fields at all: say so before the PIN check.
if (stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') !== false && !$_POST && !$_FILES) {
  flock($fh, LOCK_UN); fail('Fail terlalu besar untuk dimuat naik. Cuba gambar yang lebih kecil.', 413);
}

// ---- public: online bid with a deposit receipt (no PIN); waits for the admin's review ----
if (($_POST['action'] ?? '') === 'submitBid') {
  if (empty($state['payment']['onlineOn'])) fail('Bidaan online ditutup buat masa ini.');
  $ip = (string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '?');
  $rlFile = $DATA_DIR . '/ratelimit.json';
  $rl = json_decode((string) @file_get_contents($rlFile), true) ?: [];
  $now = time(); $key = hash('sha256', $ip);
  $rl = array_filter(array_map(fn($ts) => array_values(array_filter($ts, fn($t) => $t > $now - 600)), $rl));
  if (count($rl[$key] ?? []) >= 30) fail('Terlalu banyak bidaan dihantar dari peranti ini. Cuba lagi dalam beberapa minit.', 429);
  if (count($state['pending']) >= 2000) fail('Had bidaan online telah dicapai. Sila hubungi urus setia.');
  $name = clean((string) ($_POST['name'] ?? ''), 61);
  $phone = trim((string) preg_replace('/[^0-9+\- ]/', '', (string) ($_POST['phone'] ?? '')));
  $amount = (int) round((float) ($_POST['amount'] ?? 0));
  $lidx = lotIndex($state, (string) ($_POST['lotId'] ?? ''));
  if ($name === '' || mb_strlen($name) > 60) fail('Masukkan nama penuh (maksimum 60 aksara).');
  if (strlen((string) preg_replace('/\D/', '', $phone)) < 9) fail('Masukkan nombor telefon yang sah.');
  if ($lidx < 0) fail('Item tidak dijumpai. Muat semula halaman.');
  $lot = $state['lots'][$lidx];
  if ($lot['status'] !== 'open') fail('Bidaan untuk item ini belum dibuka atau sudah ditutup.');
  $min = minOnline($state, $lot);
  if ($amount < $min) fail('Jumlah mesti lebih tinggi daripada bidaan semasa dan bidaan online yang sedang disemak: sekurang-kurangnya RM' . number_format($min) . '.');
  if ($amount > 50000000) fail('Jumlah terlalu besar. Semak semula.');
  $f = $_FILES['receipt'] ?? null;
  if (!$f) fail('Sila lampirkan gambar resit deposit.');
  if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $f['size'] > 10 * 1024 * 1024) fail('Fail resit terlalu besar. Cuba gambar yang lebih kecil.');
  if ($f['error'] !== UPLOAD_ERR_OK) fail('Muat naik resit gagal. Cuba lagi.');
  $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
  $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'][$mime] ?? null;
  if (!$ext) fail('Resit mesti gambar (JPG, PNG, WEBP) atau PDF.');
  @mkdir($DATA_DIR . '/receipts', 0700, true);
  $id = bin2hex(random_bytes(8));
  if (!move_uploaded_file($f['tmp_name'], $DATA_DIR . '/receipts/' . $id . '.' . $ext)) fail('Tidak dapat simpan resit.', 500);
  $state['pending'][] = ['id' => $id, 'lotId' => $lot['id'], 'lotTitle' => $lot['title'], 'name' => $name, 'phone' => mb_substr($phone, 0, 20),
    'amount' => $amount, 'file' => $id . '.' . $ext, 'type' => $ext, 'at' => $now, 'status' => 'new', 'reason' => '', 'reviewedAt' => null];
  $rl[$key][] = $now; @file_put_contents($rlFile, json_encode($rl));
  $state['version'] = (int) $state['version'] + 1; $state['updatedAt'] = $now;
  ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)); fflush($fh); flock($fh, LOCK_UN);
  out(['ok' => true, 'id' => $id]);
}

// ---- admin auth ----
$pin = trim((string) @file_get_contents($PIN_FILE));
$given = trim((string) ($_SERVER['HTTP_X_PIN'] ?? ''));
if ($pin === '' || $given === '' || !hash_equals($pin, $given)) { flock($fh, LOCK_UN); sleep(2); fail('PIN salah.', 401); }

$ctype = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
if (stripos($ctype, 'multipart/form-data') !== false && !$_POST && !$_FILES) fail('Gambar terlalu besar untuk dimuat naik. Cuba gambar yang lebih kecil (JPG).');
$in = stripos($ctype, 'multipart/form-data') !== false ? $_POST : (json_decode((string) file_get_contents('php://input'), true) ?: []);
$action = (string) ($in['action'] ?? '');
$S = $state;

// the item this action works on: lotId if given, else the active item
$li = lotIndex($S, (string) ($in['lotId'] ?? $S['activeId']));
if ($li < 0 && !in_array($action, ['login', 'addLot', 'reset'], true)) fail('Item tidak dijumpai. Muat semula halaman.');
if ($li >= 0) $L = &$S['lots'][$li];

switch ($action) {
  case 'login':
    flock($fh, LOCK_UN);
    out(['ok' => true, 'state' => view($S, true)]);

  case 'open':
    if ($L['status'] === 'closed') fail('Bidaan item ini sudah ditutup. Guna "Buka semula" jika perlu.');
    foreach ($S['lots'] as $o) if ($o['id'] !== $L['id'] && $o['status'] === 'open') fail('Tutup dahulu bidaan "' . $o['title'] . '".');
    $L['status'] = 'open'; $L['openedAt'] = $L['openedAt'] ?: time();
    $S['activeId'] = $L['id'];
    break;

  case 'bid':
    if ($L['status'] !== 'open') fail('Bidaan belum dibuka atau sudah ditutup.');
    $name = clean((string) ($in['name'] ?? ''), 61);
    $phone = trim((string) preg_replace('/[^0-9+\- ]/', '', (string) ($in['phone'] ?? '')));
    $amount = (int) round((float) ($in['amount'] ?? 0));
    if ($name === '' || mb_strlen($name) > 60) fail('Masukkan nama pembida (maksimum 60 aksara).');
    $min = minNext($L);
    if ($amount < $min) fail($L['bids']
      ? 'Jumlah mesti lebih tinggi daripada bidaan semasa RM' . number_format((int) $L['bids'][count($L['bids']) - 1]['amount']) . '. Mungkin ada bidaan baharu, semak senarai.'
      : 'Bidaan pertama mesti sekurang-kurangnya harga mula RM' . number_format((int) $L['startPrice']) . '.');
    if ($amount > 50000000) fail('Jumlah terlalu besar. Semak semula.');
    $L['bids'][] = ['id' => bin2hex(random_bytes(4)), 'name' => $name, 'phone' => mb_substr($phone, 0, 20), 'amount' => $amount, 'at' => time()];
    break;

  case 'undo':
    if ($L['status'] !== 'open') fail('Bidaan hanya boleh dibatalkan semasa bidaan dibuka.');
    if (!$L['bids']) fail('Tiada bidaan untuk dibatalkan.');
    $last = $L['bids'][count($L['bids']) - 1];
    if (!empty($in['id']) && $in['id'] !== $last['id']) fail('Bidaan terakhir sudah berubah. Semak senarai semula.');
    array_pop($L['bids']);
    if (!empty($last['sub'])) foreach ($S['pending'] as &$r) {   // an approved online bid was undone: tell the guest
      if ($r['id'] === $last['sub']) { $r['status'] = 'rejected'; $r['reason'] = 'Dibatalkan oleh urus setia'; $r['reviewedAt'] = time(); }
    }
    unset($r);
    break;

  case 'close':
    if ($L['status'] !== 'open') fail('Bidaan tidak dibuka.');
    $L['status'] = 'closed'; $L['closedAt'] = time();
    $last = $L['bids'] ? $L['bids'][count($L['bids']) - 1] : null;
    $L['winner'] = $last ? ['name' => $last['name'], 'amount' => $last['amount'], 'phone' => $last['phone'], 'at' => time()] : null;
    break;

  case 'reopen':
    if ($L['status'] !== 'closed') fail('Bidaan belum ditutup.');
    if ($L['paid']) fail('Bayaran sudah disahkan. Batalkan pengesahan bayaran dahulu.');
    foreach ($S['lots'] as $o) if ($o['id'] !== $L['id'] && $o['status'] === 'open') fail('Tutup dahulu bidaan "' . $o['title'] . '".');
    $L['status'] = 'open'; $L['winner'] = null; $L['closedAt'] = null;
    $S['activeId'] = $L['id'];
    break;

  case 'paid':
    if (!$L['winner']) fail('Belum ada pemenang.');
    $L['paid'] = ['at' => time(), 'ref' => clean((string) ($in['ref'] ?? ''), 80)];
    break;

  case 'unpaid':
    $L['paid'] = null;
    break;

  case 'settings':   // start price + increment of the item; payment details are shared by all items
    $sp = (int) ($in['startPrice'] ?? $L['startPrice']);
    $inc = (int) ($in['increment'] ?? $L['increment']);
    if (($sp !== (int) $L['startPrice'] || $inc !== (int) $L['increment']) && $L['bids']) fail('Harga mula dan kenaikan tidak boleh diubah selepas ada bidaan.');
    if ($sp < 1 || $inc < 0) fail('Harga mula mesti lebih daripada 0, dan kenaikan tidak boleh negatif.');
    $L['startPrice'] = $sp; $L['increment'] = $inc;
    if (array_key_exists('deposit', $in)) { $dep = (int) $in['deposit']; if ($dep < 0) fail('Deposit tidak boleh negatif.'); $S['payment']['deposit'] = $dep; }
    if (array_key_exists('onlineOn', $in)) $S['payment']['onlineOn'] = (bool) $in['onlineOn'];
    foreach (['bank', 'accName', 'accNo', 'note'] as $k) {
      if (array_key_exists($k, $in)) $S['payment'][$k] = clean((string) $in[$k], 160);
    }
    if (array_key_exists('wa', $in)) {   // WhatsApp number for online bids, stored as digits with country code (60…)
      $d = preg_replace('/\D/', '', (string) $in['wa']);
      if ($d !== '' && $d[0] === '0') $d = '6' . $d;
      if ($d !== '' && (strlen($d) < 10 || strlen($d) > 15)) fail('Nombor WhatsApp tidak sah.');
      $S['payment']['wa'] = $d;
    }
    break;

  case 'addLot':
    $title = clean((string) ($in['title'] ?? ''), 120);
    if ($title === '') fail('Masukkan nama item.');
    $sp = (int) ($in['startPrice'] ?? 0); $inc = (int) ($in['increment'] ?? 0);
    if ($sp < 1 || $inc < 0) fail('Harga mula mesti lebih daripada 0.');
    if (count($S['lots']) >= 50) fail('Had 50 item.');
    $id = 'i' . bin2hex(random_bytes(3));
    $S['lots'][] = newLot($id, $title, clean((string) ($in['desc'] ?? ''), 1000), $sp, $inc);
    $out = ['newId' => $id];
    break;

  case 'updateLot':
    if (array_key_exists('title', $in)) { $t = clean((string) $in['title'], 120); if ($t === '') fail('Nama item tidak boleh kosong.'); $L['title'] = $t; }
    if (array_key_exists('desc', $in)) $L['desc'] = clean((string) $in['desc'], 1000);
    if (array_key_exists('startPrice', $in) || array_key_exists('increment', $in)) {
      $sp = (int) ($in['startPrice'] ?? $L['startPrice']); $inc = (int) ($in['increment'] ?? $L['increment']);
      if (($sp !== (int) $L['startPrice'] || $inc !== (int) $L['increment']) && $L['bids']) fail('Harga mula dan kenaikan tidak boleh diubah selepas ada bidaan.');
      if ($sp < 1 || $inc < 0) fail('Harga mula mesti lebih daripada 0.');
      $L['startPrice'] = $sp; $L['increment'] = $inc;
    }
    break;

  case 'deleteLot':
    if ($L['featured']) fail('Item utama tidak boleh dipadam.');
    if ($L['bids']) fail('Item yang sudah ada bidaan tidak boleh dipadam.');
    if ($L['status'] === 'open') fail('Tutup bidaan item ini dahulu.');
    foreach (glob($IMG_DIR . '/' . $L['id'] . '.*') ?: [] as $old) @unlink($old);
    $gone = $L['id']; unset($L);
    array_splice($S['lots'], $li, 1);
    if ($S['activeId'] === $gone) $S['activeId'] = $S['lots'][0]['id'];
    break;

  case 'setActive':   // which item the projector and phones show
    foreach ($S['lots'] as $o) if ($o['id'] !== $L['id'] && $o['status'] === 'open') fail('Tutup dahulu bidaan "' . $o['title'] . '" sebelum menukar item.');
    $S['activeId'] = $L['id'];
    break;

  case 'uploadImage':
    $f = $_FILES['image'] ?? null;
    if (!$f) fail('Tiada gambar dipilih.');
    if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) fail('Gambar terlalu besar untuk dimuat naik. Cuba gambar yang lebih kecil (JPG).');
    if ($f['error'] !== UPLOAD_ERR_OK) fail('Muat naik gambar gagal.');
    if ($f['size'] > 8 * 1024 * 1024) fail('Gambar terlalu besar (maksimum 8MB).');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$mime] ?? null;
    if (!$ext) fail('Hanya gambar JPG, PNG atau WEBP.');
    if (!is_dir($IMG_DIR)) @mkdir($IMG_DIR, 0700, true);
    foreach (glob($IMG_DIR . '/' . $L['id'] . '.*') ?: [] as $old) @unlink($old);
    if (!move_uploaded_file($f['tmp_name'], $IMG_DIR . '/' . $L['id'] . '.' . $ext)) fail('Tidak dapat simpan gambar.', 500);
    $L['image'] = 'api.php?img=' . $L['id'] . '&t=' . time();
    break;

  case 'removeImage':
    foreach (glob($IMG_DIR . '/' . $L['id'] . '.*') ?: [] as $old) @unlink($old);
    $L['image'] = '';
    break;

  case 'reviewBid':   // approve = becomes a real bid now (must still beat the current highest); reject = with a reason
    $pi = -1; foreach ($S['pending'] as $i => $r) if ($r['id'] === ($in['id'] ?? '')) $pi = $i;
    if ($pi < 0) fail('Bidaan online tidak dijumpai.');
    $P = &$S['pending'][$pi];
    if ($P['status'] !== 'new') fail('Bidaan ini sudah disemak.');
    if (($in['decision'] ?? '') === 'reject') {
      $P['status'] = 'rejected'; $P['reason'] = clean((string) ($in['reason'] ?? ''), 160); $P['reviewedAt'] = time();
    } elseif (($in['decision'] ?? '') === 'approve') {
      $ri = lotIndex($S, $P['lotId']);
      if ($ri < 0) fail('Item bidaan ini sudah dipadam.');
      $T = &$S['lots'][$ri];
      if ($T['status'] !== 'open') fail('Bidaan item ini sudah ditutup. Tolak bidaan ini dengan sebab.');
      if ($P['amount'] < minNext($T)) fail('Jumlah RM' . number_format($P['amount']) . ' sudah dilepasi oleh bidaan semasa. Tolak dengan sebab "sudah dilepasi".');
      $T['bids'][] = ['id' => bin2hex(random_bytes(4)), 'name' => $P['name'], 'phone' => $P['phone'], 'amount' => $P['amount'], 'at' => time(), 'online' => true, 'sub' => $P['id']];
      unset($T);
      $P['status'] = 'ok'; $P['reviewedAt'] = time();
    } else fail('Keputusan tidak sah.');
    unset($P);
    break;

  case 'reset':   // clears bidding on every item; keeps the items, prices and payment details
    if (($in['confirm'] ?? '') !== 'RESET') fail('Taip RESET untuk sahkan.');
    @mkdir($DATA_DIR . '/backups', 0700, true);
    @file_put_contents($DATA_DIR . '/backups/state-' . date('Ymd-His') . '.json', json_encode($S, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    unset($L);
    foreach ($S['lots'] as &$l) { $l['status'] = 'draft'; $l['bids'] = []; $l['winner'] = null; $l['paid'] = null; $l['openedAt'] = null; $l['closedAt'] = null; }
    unset($l);
    $S['activeId'] = $S['lots'][0]['id'];
    $S['pending'] = [];
    foreach (glob($DATA_DIR . '/receipts/*') ?: [] as $old) @rename($old, $DATA_DIR . '/backups/' . basename($old));
    break;

  default:
    fail('Tindakan tidak dikenali.');
}
unset($L);

$S['version'] = (int) $S['version'] + 1;
$S['updatedAt'] = time();
ftruncate($fh, 0); rewind($fh);
fwrite($fh, json_encode($S, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fflush($fh);
flock($fh, LOCK_UN);
out(['ok' => true, 'state' => view($S, true)] + ($out ?? []));
