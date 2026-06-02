export interface ProjectSettingsPayload {
  scan_strategy: {
    enabled: boolean;
    paths: string[];
    exclude_patterns: string[];
  };
  parsing_rules: {
    strict_frontmatter: boolean;
    allowed_categories: string[];
  };
  path_config: {
    docs_root: string;
    kernel_ref: string;
  };
}

export interface ProjectSettingsView extends ProjectSettingsPayload {
  project_id: string;
  updated_at: string | null;
}
