// "vehicle_type@2" -> { fieldId: 'vehicle_type', index: 2 }; "weather" -> { fieldId: 'weather', index: null }
export function parseFieldKey(key) {
  const [fieldId, idx] = String(key).split('@');
  return { fieldId, index: idx === undefined ? null : Number(idx) };
}

export function fieldKey(fieldId, index) {
  return index ? `${fieldId}@${index}` : fieldId;
}
