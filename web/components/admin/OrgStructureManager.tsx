'use client';
import { useMemo, useState } from 'react';
import { PlusIcon, PencilSimpleIcon, ProhibitIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldShell, Input as UiInput, Select as UiSelect } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  useDepartments, useDepartmentMutations,
  useJobTitles, useJobTitleMutations,
  useLocations, useLocationMutations,
  useDepartmentOptions, LOCATION_TYPE_LABELS,
} from '@/hooks/useOrgStructure';
import type { Department, JobTitle, Location, LocationType } from '@/types';

type Entity = 'department' | 'jobTitle' | 'location';
const LOCATION_TYPES: LocationType[] = ['CARE_SERVICE', 'SUPPORTED_LIVING', 'RESIDENTIAL_HOME', 'OFFICE', 'MAINTENANCE_BASE', 'OTHER'];

const META: Record<Entity, { title: string; subtitle: string; singular: string }> = {
  department: { title: 'Departments', subtitle: 'How your organisation is grouped — Care, HR, Finance, IT…', singular: 'department' },
  jobTitle: { title: 'Job Titles', subtitle: 'What people do. Never a system permission.', singular: 'job title' },
  location: { title: 'Locations', subtitle: 'Services and offices. Geofence here does NOT affect care clock-in yet — House settings still do.', singular: 'location' },
};

export function OrgStructureManager({ entity }: { entity: Entity }) {
  const toast = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState<null | { mode: 'create' } | { mode: 'edit'; row: any }>(null);

  const deptList = useDepartments({ includeInactive: showInactive });
  const jobList = useJobTitles({ includeInactive: showInactive });
  const locList = useLocations({ includeInactive: showInactive });
  const list = entity === 'department' ? deptList : entity === 'jobTitle' ? jobList : locList;

  const deptMut = useDepartmentMutations();
  const jobMut = useJobTitleMutations();
  const locMut = useLocationMutations();
  const mut = entity === 'department' ? deptMut : entity === 'jobTitle' ? jobMut : locMut;

  const { data: deptOptions = [] } = useDepartmentOptions(entity === 'jobTitle');

  const rows: any[] = list.data ?? [];
  const meta = META[entity];

  const blank = useMemo(() => {
    if (entity === 'department') return { name: '', code: '' };
    if (entity === 'jobTitle') return { name: '', departmentId: '' };
    return { name: '', type: 'CARE_SERVICE' as LocationType, address: '', latitude: '', longitude: '', geofenceRadius: '', timezone: '' };
  }, [entity]);
  const [formVal, setFormVal] = useState<any>(blank);

  function startCreate() { setFormVal(blank); setOpen({ mode: 'create' }); }
  function startEdit(row: any) {
    if (entity === 'department') setFormVal({ name: row.name, code: row.code ?? '' });
    else if (entity === 'jobTitle') setFormVal({ name: row.name, departmentId: row.departmentId ?? '' });
    else setFormVal({
      name: row.name, type: row.type, address: row.address ?? '',
      latitude: row.latitude != null ? String(row.latitude) : '',
      longitude: row.longitude != null ? String(row.longitude) : '',
      geofenceRadius: row.geofenceRadius != null ? String(row.geofenceRadius) : '',
      timezone: row.timezone ?? '',
    });
    setOpen({ mode: 'edit', row });
  }

  function buildBody() {
    if (entity === 'department') return { name: formVal.name.trim(), code: formVal.code.trim() || null };
    if (entity === 'jobTitle') return { name: formVal.name.trim(), departmentId: formVal.departmentId || null };
    return {
      name: formVal.name.trim(), type: formVal.type,
      address: formVal.address.trim() || null,
      latitude: formVal.latitude === '' ? null : parseFloat(formVal.latitude),
      longitude: formVal.longitude === '' ? null : parseFloat(formVal.longitude),
      geofenceRadius: formVal.geofenceRadius === '' ? null : parseInt(formVal.geofenceRadius, 10),
      timezone: formVal.timezone.trim() || null,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (open?.mode === 'create') await mut.create.mutateAsync(buildBody());
      else if (open?.mode === 'edit') await mut.update.mutateAsync({ id: open.row.id, ...buildBody() });
      setOpen(null);
      toast.success(`${meta.singular[0].toUpperCase()}${meta.singular.slice(1)} saved`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? `Could not save ${meta.singular}`);
    }
  }

  async function toggleActive(row: any) {
    try {
      if (row.active) await mut.deactivate.mutateAsync(row.id);
      else await mut.reactivate.mutateAsync(row.id);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not update status');
    }
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-on-surface">{meta.title}</h2>
          <p className="text-xs text-on-surface-variant font-inter mt-0.5 max-w-md">{meta.subtitle}</p>
        </div>
        <Button variant="primary" size="sm" icon={<PlusIcon size={15} />} onClick={startCreate}>Add</Button>
      </div>

      <label className="flex items-center gap-2 text-xs text-on-surface-variant mb-3">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show deactivated
      </label>

      <div className="divide-y divide-outline-variant/40">
        {rows.length === 0 && <p className="text-sm text-on-surface-variant py-4">None yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className={`flex items-center justify-between py-2.5 ${row.active ? '' : 'opacity-55'}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">
                {row.name}
                {entity === 'location' && <span className="ml-2 text-xs text-on-surface-variant">· {LOCATION_TYPE_LABELS[(row as Location).type]}</span>}
                {entity === 'jobTitle' && (row as JobTitle).department && <span className="ml-2 text-xs text-on-surface-variant">· {(row as JobTitle).department!.name}</span>}
                {entity === 'department' && (row as Department).code && <span className="ml-2 text-xs text-on-surface-variant">({(row as Department).code})</span>}
              </p>
              {!row.active && <p className="text-[11px] text-danger">Deactivated</p>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => startEdit(row)} className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-primary/10" aria-label={`Edit ${row.name}`}>
                <PencilSimpleIcon size={15} />
              </button>
              <button onClick={() => toggleActive(row)} className="p-1.5 rounded text-on-surface-variant hover:text-danger hover:bg-danger/10" aria-label={row.active ? `Deactivate ${row.name}` : `Reactivate ${row.name}`}>
                {row.active ? <ProhibitIcon size={15} /> : <ArrowCounterClockwiseIcon size={15} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={`${open?.mode === 'edit' ? 'Edit' : 'Add'} ${meta.singular}`}>
        <form onSubmit={submit} className="space-y-4">
          <FieldShell label="Name *">
            <UiInput type="text" value={formVal.name} onChange={(e) => setFormVal({ ...formVal, name: e.target.value })} required />
          </FieldShell>

          {entity === 'department' && (
            <FieldShell label="Code (optional)">
              <UiInput type="text" value={formVal.code} onChange={(e) => setFormVal({ ...formVal, code: e.target.value })} />
            </FieldShell>
          )}

          {entity === 'jobTitle' && (
            <FieldShell
              label="Department"
              hint="Groups this job title and pre-filters it when adding an employee. It never grants system access. Leave unassigned only for legacy titles."
            >
              <UiSelect value={formVal.departmentId} onChange={(e) => setFormVal({ ...formVal, departmentId: e.target.value })}>
                <option value="">No department (unassigned)</option>
                {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </UiSelect>
            </FieldShell>
          )}

          {entity === 'location' && (
            <>
              <FieldShell label="Type *">
                <UiSelect value={formVal.type} onChange={(e) => setFormVal({ ...formVal, type: e.target.value as LocationType })}>
                  {LOCATION_TYPES.map((t) => <option key={t} value={t}>{LOCATION_TYPE_LABELS[t]}</option>)}
                </UiSelect>
              </FieldShell>
              <FieldShell label="Address">
                <UiInput type="text" value={formVal.address} onChange={(e) => setFormVal({ ...formVal, address: e.target.value })} />
              </FieldShell>
              <div className="grid grid-cols-3 gap-3">
                <FieldShell label="Latitude">
                  <UiInput type="number" step="any" value={formVal.latitude} onChange={(e) => setFormVal({ ...formVal, latitude: e.target.value })} />
                </FieldShell>
                <FieldShell label="Longitude">
                  <UiInput type="number" step="any" value={formVal.longitude} onChange={(e) => setFormVal({ ...formVal, longitude: e.target.value })} />
                </FieldShell>
                <FieldShell label="Geofence (m)">
                  <UiInput type="number" min="1" max="5000" value={formVal.geofenceRadius} onChange={(e) => setFormVal({ ...formVal, geofenceRadius: e.target.value })} />
                </FieldShell>
              </div>
              <FieldShell label="Timezone (optional)" hint="Blank inherits the agency timezone.">
                <UiInput type="text" placeholder="Europe/London" value={formVal.timezone} onChange={(e) => setFormVal({ ...formVal, timezone: e.target.value })} />
              </FieldShell>
              <p className="text-xs text-on-surface-variant">
                Phase 1: these geofence values are stored for reporting only — care clock-in still uses each House’s own geofence.
              </p>
            </>
          )}

          <div className="flex gap-2 justify-end pt-3">
            <Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={mut.create.isPending || mut.update.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
