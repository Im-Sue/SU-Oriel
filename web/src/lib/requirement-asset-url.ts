const ASSET_RELATIVE_RE = /(!\[[^\]]*\]\()\.\/assets\/requirements\/([^/)]+)\/([^)]+)\)/g;

export function rewriteRequirementAssetUrls(markdown: string, projectId?: string | null): string {
  if (!projectId) return markdown;
  return markdown.replace(
    ASSET_RELATIVE_RE,
    `$1/api/projects/${projectId}/requirements/$2/assets/$3)`
  );
}
