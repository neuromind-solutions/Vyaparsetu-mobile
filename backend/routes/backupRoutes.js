const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backupController');

router.post('/local', backupController.createLocalBackup);
router.get('/list', backupController.listBackups);
router.post('/restore', backupController.restoreBackup);
router.get('/export', backupController.exportBackup);
router.get('/download/:filename', backupController.downloadBackup);
router.post('/import', backupController.importBackup);
router.get('/status', backupController.getBackupStatus);
router.get('/internet-status', backupController.checkInternetStatus);
router.get('/config', backupController.getConfig);
router.post('/config', backupController.saveConfig);
router.post('/auto-sync', backupController.performAutoSync);

module.exports = router;
