// License and .gitignore catalogue shapes for the new-repository wizard.

/** Placeholder inputs a license template needs the user to fill in. */
export type LicenseField = 'year' | 'holder';

/** Catalogue entry as sent to the client; template bodies stay on the server. */
export interface LicenseSummary {
  id: string;
  name: string;
  summary: string;
  fields: LicenseField[];
}

export interface GitignoreSummary {
  id: string;
  name: string;
}

export interface TemplateCatalogue {
  licenses: LicenseSummary[];
  gitignores: GitignoreSummary[];
}

export interface LicenseValues {
  year?: string;
  holder?: string;
}
