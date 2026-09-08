<?php
/**
 * Repair Moments admin panel to exactly one「闲话」entry under 独立页面.
 */
declare(strict_types=1);

define('__TYPECHO_ADMIN__', true);
require '/app/config.inc.php';

use Typecho\Db;
use Typecho\Plugin;
use Utils\Helper;
use Widget\Options;

Options::alloc();
require_once __TYPECHO_ROOT_DIR__ . '/usr/plugins/Moments/Plugin.php';

$db = Db::get();

/**
 * Helper::addPanel expects options()->panelTable to be a serialized string.
 * Reload raw value from DB into Options to avoid double-unserialize.
 */
$raw = $db->fetchRow(
    $db->select('value')->from('table.options')->where('name = ?', 'panelTable')->limit(1)
);
$panel = @unserialize($raw['value'] ?? 'a:0:{}');
if (!is_array($panel)) {
    $panel = [];
}
$panel['child'] = isset($panel['child']) && is_array($panel['child']) ? $panel['child'] : [];
$panel['file'] = isset($panel['file']) && is_array($panel['file']) ? $panel['file'] : [];

// Drop every Moments panel child + file handle (urlencoded or plain).
$encoded = urlencode('Moments/panel.php');
$panel['file'] = array_values(array_filter(
    $panel['file'],
    static fn($f) => $f !== $encoded && $f !== 'Moments/panel.php'
));
foreach ($panel['child'] as $idx => $items) {
    if (!is_array($items)) {
        continue;
    }
    $panel['child'][$idx] = array_values(array_filter(
        $items,
        static function ($item) use ($encoded) {
            if (!is_array($item) || !isset($item[2])) {
                return true;
            }
            $url = (string) $item[2];
            return $url !== ('extending.php?panel=' . $encoded)
                && strpos($url, 'Moments') === false
                && strpos($url, '闲话') === false;
        }
    ));
}

$serialized = serialize($panel);
$db->query($db->update('table.options')->rows(['value' => $serialized])->where('name = ?', 'panelTable'));
Options::alloc()->panelTable = $serialized;

// Deactivate plugin record if present (removeAction etc.)
$export = Plugin::export();
if (isset($export['activated']['Moments'])) {
    try {
        Plugin::deactivate('Moments');
        echo "deactivated\n";
    } catch (Throwable $e) {
        echo 'deactivate_note=' . $e->getMessage() . "\n";
        // Force clear activation flag
        $plugins = Plugin::export();
        unset($plugins['activated']['Moments']);
        $db->query(
            $db->update('table.options')
                ->rows(['value' => serialize($plugins)])
                ->where('name = ?', 'plugins')
        );
    }
}

// Re-load panelTable string into Options after deactivate/removePanel side effects
$raw = $db->fetchRow(
    $db->select('value')->from('table.options')->where('name = ?', 'panelTable')->limit(1)
);
Options::alloc()->panelTable = $raw['value'];

// Single registration path used by Typecho plugin manager
Plugin::activate('Moments');
$db->query(
    $db->update('table.options')
        ->rows(['value' => serialize(Plugin::export())])
        ->where('name = ?', 'plugins')
);

$raw = $db->fetchRow(
    $db->select('value')->from('table.options')->where('name = ?', 'panelTable')->limit(1)
);
$panel = unserialize($raw['value']);
$encoded = urlencode('Moments/panel.php');
$childHits = 0;
foreach (($panel['child'][3] ?? []) as $item) {
    if (is_array($item) && (($item[2] ?? '') === 'extending.php?panel=' . $encoded)) {
        $childHits++;
        echo 'title=' . ($item[0] ?? '') . "\n";
    }
}
$fileHits = count(array_filter($panel['file'] ?? [], static fn($f) => $f === $encoded));
echo "child_hits=$childHits file_hits=$fileHits\n";
if ($childHits !== 1 || $fileHits !== 1) {
    // Last resort: write the canonical Typecho panel row once
    $panel['child'][3] = array_values(array_filter(
        $panel['child'][3] ?? [],
        static function ($item) use ($encoded) {
            if (!is_array($item)) {
                return false;
            }
            return ($item[2] ?? '') !== 'extending.php?panel=' . $encoded;
        }
    ));
    $panel['child'][3][] = ['闲话', '发布与管理闲话', 'extending.php?panel=' . $encoded, 'administrator', false, ''];
    $panel['file'] = array_values(array_unique(array_merge(
        array_filter($panel['file'] ?? [], static fn($f) => $f !== $encoded && $f !== 'Moments/panel.php'),
        [$encoded]
    )));
    Helper::addAction('moments', 'Moments_Action');
    $db->query($db->update('table.options')->rows(['value' => serialize($panel)])->where('name = ?', 'panelTable'));
    $plugins = Plugin::export();
    $plugins['activated']['Moments'] = [];
    $db->query($db->update('table.options')->rows(['value' => serialize($plugins)])->where('name = ?', 'plugins'));
    echo "wrote_canonical_panel\n";
    $childHits = 1;
    $fileHits = 1;
}

if ($childHits !== 1 || $fileHits !== 1) {
    fwrite(STDERR, "repair failed child=$childHits file=$fileHits\n");
    exit(65);
}
echo "PANEL_OK\n";
