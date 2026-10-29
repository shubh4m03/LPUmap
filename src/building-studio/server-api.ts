/**
 * The Building Studio's server API as a port (docs/BUILDING_STUDIO_DESIGN.md §7):
 * the operations the Studio needs and the request/response shapes of
 * ./schema.ts. The admin's HTTP client implements it (src/admin/api/studio.ts,
 * `StudioApi = StudioServerApi<AdminApiError>`) and the admin hands it to the
 * Studio UI (./ui/actions.ts), so the Studio never imports the admin.
 *
 * `E` is the client's failure value; the Studio reads only the fields of
 * `StudioServerFailure` and leaves describing a failure to the client.
 */
import type {
  ApplyTemplateRequest,
  ApplyTemplateResponse,
  ArchiveRequest,
  CreateStudioBuildingRequest,
  DeleteStudioBuildingRequest,
  DeleteStudioBuildingResponse,
  DuplicateRequest,
  OwnerTemplateInput,
  PublishRequest,
  PublishResponse,
  RestoreRequest,
  SaveDraftRequest,
  StudioBuildingDetail,
  StudioBuildingList,
  StudioLibraryResponse,
  StudioListQuery,
  StudioQualityResponse,
  TemplateListing,
  ValidateRequest,
  ValidationResult,
} from './schema.ts';

/** What the Studio reads from a failed call. */
export interface StudioServerFailure {
  /** The failure class; the Studio tests for 'conflict' and 'aborted'. */
  kind: string;
  /** The server's error code, or null when the response had none. */
  code: string | null;
  /** 409: the server's current copy of the record. */
  current: unknown;
  /** 422 `validation-failed`: the validation that blocked the write. */
  validation: ValidationResult | null;
}

/** A call's outcome: the parsed 2xx body, or the client's failure value. Never both. */
export type StudioServerResult<T, E extends StudioServerFailure = StudioServerFailure> =
  { ok: true; status: number; data: T } | { ok: false; error: E };

export interface StudioRevisionBody {
  revision: number;
}

type R<T, E extends StudioServerFailure> = Promise<StudioServerResult<T, E>>;
type Opts = { signal?: AbortSignal };

export interface StudioServerApi<E extends StudioServerFailure = StudioServerFailure> {
  library(o?: Opts): R<StudioLibraryResponse, E>;
  createTemplate(definition: OwnerTemplateInput): R<TemplateListing, E>;
  /** Creates a new immutable version of an owner template. */
  updateTemplate(
    templateId: string,
    body: { revision: number; definition: OwnerTemplateInput },
  ): R<TemplateListing, E>;
  retireTemplate(templateId: string, body: StudioRevisionBody): R<TemplateListing, E>;
  unretireTemplate(templateId: string, body: StudioRevisionBody): R<TemplateListing, E>;

  listBuildings(q?: StudioListQuery, o?: Opts): R<StudioBuildingList, E>;
  getBuilding(id: string, o?: Opts): R<StudioBuildingDetail, E>;
  createBuilding(body: CreateStudioBuildingRequest): R<StudioBuildingDetail, E>;
  saveDraft(id: string, body: SaveDraftRequest): R<StudioBuildingDetail, E>;
  discardDraft(id: string, body: StudioRevisionBody): R<StudioBuildingDetail, E>;
  /** Dry run: no write. */
  validate(body: ValidateRequest, o?: Opts): R<ValidationResult, E>;
  publish(id: string, body: PublishRequest): R<PublishResponse, E>;
  archive(id: string, body: ArchiveRequest): R<PublishResponse, E>;
  restore(id: string, body: RestoreRequest): R<PublishResponse, E>;
  /** Permanent; only archived records; `confirmId` must equal `id`. */
  deleteBuilding(id: string, body: DeleteStudioBuildingRequest): R<DeleteStudioBuildingResponse, E>;
  duplicate(id: string, body: DuplicateRequest): R<StudioBuildingDetail, E>;
  /** `dryRun: true` previews (nothing saved). */
  applyTemplate(id: string, body: ApplyTemplateRequest): R<ApplyTemplateResponse, E>;
  quality(o?: Opts): R<StudioQualityResponse, E>;
}
