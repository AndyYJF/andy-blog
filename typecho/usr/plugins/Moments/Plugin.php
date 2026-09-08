<?php
use Typecho\Plugin\PluginInterface;
use Typecho\Widget\Helper\Form;
use Utils\Helper;

require_once __DIR__ . '/Action.php';

/**
 * Moments — mobile-friendly “闲话” publish panel backed by Typecho posts.
 *
 * Typecho Plugin
 * @package Moments
 * @author AndyYan
 * @version 1.0.0
 * @link https://www.andy-y.cn
 */
class Moments_Plugin implements PluginInterface
{
    public static function activate()
    {
        Helper::addPanel(3, 'Moments/panel.php', '闲话', '发布与管理闲话', 'administrator');
        Helper::addAction('moments', 'Moments_Action');
        return _t('Moments 已启用：后台「闲话」面板可用');
    }

    public static function deactivate()
    {
        Helper::removeAction('moments');
        Helper::removePanel(3, 'Moments/panel.php');
    }

    public static function config(Form $form)
    {
    }

    public static function personalConfig(Form $form)
    {
    }
}
