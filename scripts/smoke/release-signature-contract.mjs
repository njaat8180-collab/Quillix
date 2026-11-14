export function releaseSignatureReport({ required = false, appStatus = 'Unknown', installerStatus = 'Unknown', installerExists = true } = {}) {
  const valid = installerExists && appStatus === 'Valid' && installerStatus === 'Valid';
  return {
    status: valid ? 'PASS' : required ? 'FAIL' : 'WARN',
    signatureStatus: appStatus,
    signatures: { app: appStatus, installer: installerExists ? installerStatus : 'Missing' },
    required,
    guidance: valid
      ? 'Authenticode signatures are valid for both packaged files.'
      : 'Configure CSC_LINK and CSC_KEY_PASSWORD before production distribution; sign both the app executable and installer.',
    ...(!installerExists ? { error: 'Packaged installer was not found.' } : {}),
  };
}
