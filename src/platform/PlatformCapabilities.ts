export interface PlatformCapabilities {
  canGenerate: boolean;
  canEdit: boolean;
  canImportSkill: boolean;
  canPreview: boolean;
}

export function derivePlatformCapabilities(isMobile: boolean): PlatformCapabilities {
  return {
    canGenerate: !isMobile,
    canEdit: !isMobile,
    canImportSkill: !isMobile,
    canPreview: true
  };
}
