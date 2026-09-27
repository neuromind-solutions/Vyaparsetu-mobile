const express = require('express');
const router = express.Router();
const driveController = require('../controllers/googleDriveController');

router.get('/auth-url', driveController.getAuthUrl);
router.get('/callback', driveController.handleCallback);
router.get('/oauth-callback', driveController.handleCallback);
router.get('/status', driveController.getStatus);
router.post('/auto-backup', driveController.autoBackup);
router.post('/backup', driveController.backup);
router.get('/backups', driveController.listBackups);
router.post('/restore', driveController.restore);
router.post('/disconnect', driveController.disconnect);

module.exports = router;
