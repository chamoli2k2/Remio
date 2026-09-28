import { useMemo } from 'react';
import Select, { fold } from './Select';

/**
 * The app's dropdown, taught about countries.
 *
 * The value is a country code, never a name. Display names drift between browser versions and these
 * end up stored on accounts and invoices, so the stable half is what travels. Where `name` is given
 * a hidden input carries the matching country name, because that is the shape the server stores and
 * a plain form post has to keep working without knowing any of this.
 */
export default function CountryPicker({
  value, onChange, options, name, disabled, label = 'Country',
  placeholder = 'Choose a country', searchFrom = 12,
}) {
  const items = useMemo(() => options.map(c => ({ value: c.code, label: c.name, dial: c.dial || '' })), [options]);
  return <Select
    value={value} onChange={onChange} options={items} name={name} disabled={disabled}
    label={label} placeholder={placeholder} searchFrom={searchFrom} searchPlaceholder="Search countries"
    // Also findable by code and by dialling code, because somebody who knows theirs types it faster
    // than they spell the name, and the dialling code is on screen right next to this field.
    match={(o, q) => fold(o.label).includes(q) || o.value.toLowerCase() === q || o.dial.includes(q)}
    // The server stores the name rather than the code, so that is what a plain form post carries.
    formValue={o => o.label}/>;
}
