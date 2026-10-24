/** Inputs for the editable place fields (position and access point have their own controls). */
import { LIMITS } from '../../community/schema.ts';
import { TextInput } from '../../components/ui/TextInput.tsx';
import type { VerificationStatus, Wheelchair } from '../../data/schema.ts';
import { SelectField, TextArea } from '../ui/fields.tsx';
import type { FieldErrors } from '../ui/form-errors.ts';
import { CATEGORY_OPTIONS, VERIFICATION_OPTIONS, WHEELCHAIR_OPTIONS } from '../ui/format.ts';
import type { PlaceFormValues } from './place-form.ts';

export interface PlaceFieldsFormProps {
  values: PlaceFormValues;
  onChange(next: PlaceFormValues): void;
  errors: FieldErrors;
  disabled?: boolean;
  /** Show the less common fields (hours, links, verification). Default true. */
  extended?: boolean;
}

export function PlaceFieldsForm({
  values,
  onChange,
  errors,
  disabled,
  extended = true,
}: PlaceFieldsFormProps) {
  const set = <K extends keyof PlaceFormValues>(k: K, v: PlaceFormValues[K]) =>
    onChange({ ...values, [k]: v });
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-text">Details</legend>
      <TextInput
        label="Name"
        required
        maxLength={LIMITS.name.max}
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
        error={errors.name}
      />
      <SelectField
        label="Category"
        required
        value={values.categoryId}
        onChange={(e) => set('categoryId', e.target.value)}
        options={[{ value: '', label: 'Choose a category' }, ...CATEGORY_OPTIONS]}
        error={errors.categoryId}
      />
      <TextArea
        label="Description (optional, public)"
        maxLength={LIMITS.description}
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
        error={errors.description}
      />
      {extended ? (
        <>
          <TextInput
            label="Opening hours (optional)"
            hint="As published, for example “Mo-Sa 09:00-18:00”."
            maxLength={LIMITS.openingHours}
            value={values.openingHours}
            onChange={(e) => set('openingHours', e.target.value)}
            error={errors.openingHours}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Wheelchair access"
              value={values.wheelchair}
              onChange={(e) => set('wheelchair', e.target.value as Wheelchair)}
              options={WHEELCHAIR_OPTIONS}
              error={errors.wheelchair}
            />
            <SelectField
              label="Verification"
              value={values.verificationStatus}
              onChange={(e) => set('verificationStatus', e.target.value as VerificationStatus)}
              options={VERIFICATION_OPTIONS}
              error={errors.verificationStatus}
              hint="Choose “Verified” only after checking it yourself or against an official source."
            />
          </div>
          <TextInput
            label="Last verified on (optional)"
            type="date"
            value={values.lastVerifiedAt}
            onChange={(e) => set('lastVerifiedAt', e.target.value)}
            error={errors.lastVerifiedAt}
          />
          <TextInput
            label="Website (optional)"
            type="url"
            inputMode="url"
            maxLength={LIMITS.url}
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
            error={errors.website}
          />
          <TextInput
            label="Source link (optional, public)"
            hint="Where this information can be checked."
            type="url"
            inputMode="url"
            maxLength={LIMITS.url}
            value={values.sourceUrl}
            onChange={(e) => set('sourceUrl', e.target.value)}
            error={errors.sourceUrl}
          />
        </>
      ) : null}
    </fieldset>
  );
}
