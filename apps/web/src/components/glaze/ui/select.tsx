'use client';

import * as React from 'react';
import {Input as InputPrimitive} from '@base-ui/react/input';
import {Select as SelectPrimitive} from '@base-ui/react/select';
import {Icon, Check, ChevronDown, ChevronSort, ChevronUp} from '#/components/glaze/icon.tsx';
import {menuItemClass, menuLabelClass, menuPopupClass, menuSeparatorClass} from '#/lib/glaze/overlay.ts';
import {useGlazePortal} from '#/lib/glaze/portal.ts';
import {cn, controlHeight, mergeClass} from '#/lib/glaze/utils.ts';
import {useFieldDisabled} from '#/components/glaze/ui/field.tsx';

// Glaze's select, on Base UI's Select: one choice from a list in a popup.
//
// The trigger is the field pill Input uses (styles.css, field): paper, the 1px --line-control hairline, 32px tall, 26
// small, 36 large, the value in 13/400 and an up-down caret in text-3 at the end. It is a button, so it answers the
// pointer: hover lays the flat button's 3% wash, and focus or an open popup darkens the line to --line-focus, the same
// as a field with the cursor in it, never an ink ring. Invalid turns the line coral; disabled sits on the grey field.
//
// The popup is the list recipe every Glaze list shares (lib/overlay.ts): the overlay surface, 4px in, 32px rows, at
// least as wide as the trigger. The chosen row carries a check in its leading 28px column, where the dropdown menu's
// checkbox rows put theirs, so a menu and a select read as one list.
//
// native renders the platform <select> on the same pill: the phone's own picker and no popup.

type SelectSize = 'sm' | 'default' | 'lg';

/**
 * The field pill as a button: Select's trigger and the date picker's. Hover takes the flat wash; focus-visible and an
 * open popup darken the line, as a field does with the cursor in it.
 */
const fieldTriggerClass = cn(
  'field group/trigger w-full cursor-default justify-between text-start select-none [-webkit-tap-highlight-color:transparent]',
  'hover:not-data-disabled:bg-(--flat-hover) data-popup-open:border-line-focus',
  'focus-visible:border-line-focus',
  'aria-invalid:border-fail data-disabled:cursor-not-allowed data-disabled:border-line-faint data-disabled:bg-field data-disabled:text-text-disabled',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-text-3 data-disabled:[&_svg]:text-text-disabled',
  'forced-colors:border-[ButtonText]',
);

/** The pill's size: its height token, the text and the icon inside it. */
const fieldTriggerSize: Record<SelectSize, string> = {
  sm: `${controlHeight.sm} [--field-h:auto] px-2.5 type-caption [&_svg]:size-(--icon-sm)`,
  default: `${controlHeight.default} [--field-h:auto] type-body-sm [&_svg]:size-(--icon)`,
  lg: `${controlHeight.lg} [--field-h:auto] px-3.5 type-body [&_svg]:size-(--icon-lg)`,
};

type SelectItemDef = {value: string; label: React.ReactNode; disabled?: boolean};
type SelectItems = readonly SelectItemDef[] | Record<string, React.ReactNode>;

const listOf = (items?: SelectItems): SelectItemDef[] => !items ? [] : Array.isArray(items) ? [...items] : Object.entries(items).map(([value, label]) => ({value, label}));

type SelectProps = Omit<SelectPrimitive.Root.Props<string>, 'items' | 'onValueChange'> & {
  /** The options, so the trigger shows the chosen label before the popup has opened. Required with native. */
  items?: SelectItems;
  onValueChange?: (value: string | null) => void;
  /** Renders the platform <select> from items on the same pill. */
  native?: boolean;
  /** native: 26, 32 or 36px. The popup trigger takes its size on SelectTrigger. */
  size?: SelectSize;
  /** native: the empty first option, shown in text-3. */
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

function Select({items, native, size = 'default', placeholder, className, children, onValueChange, ...props}: SelectProps) {
  const list = React.useMemo(() => listOf(items), [items]);
  const inField = useFieldDisabled();
  if (native) {
    const {value, defaultValue, disabled, name, required, id, inputRef: _ref, ...rest} = props as Record<string, unknown> & {value?: string | null; defaultValue?: string | null};
    const aria = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('aria-') || k.startsWith('data-')));
    return <NativeSelect
      size={size}
      className={className}
      value={value === undefined ? undefined : value ?? ''}
      defaultValue={defaultValue === undefined ? undefined : defaultValue ?? ''}
      disabled={!!disabled || inField}
      name={name as string | undefined}
      required={required as boolean | undefined}
      id={id as string | undefined}
      onChange={e => onValueChange?.(e.currentTarget.value || null)}
      {...aria}
    >
      {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
      {list.map(i => <option key={i.value} value={i.value} disabled={i.disabled}>{typeof i.label === 'string' ? i.label : i.value}</option>)}
    </NativeSelect>;
  }
  return <SelectPrimitive.Root
    data-slot="select"
    items={items === undefined ? undefined : list.map(i => ({value: i.value, label: i.label}))}
    onValueChange={onValueChange as SelectPrimitive.Root.Props<string>['onValueChange']}
    {...props}
    disabled={props.disabled || inField}
  >{children}</SelectPrimitive.Root>;
}

type SelectTriggerProps = SelectPrimitive.Trigger.Props & {
  /** 26, 32 or 36px. Match the buttons and fields beside it. */
  size?: SelectSize;
  'aria-invalid'?: boolean;
};

function SelectTrigger({className, size = 'default', children, 'aria-invalid': invalid, ...props}: SelectTriggerProps) {
  return <SelectPrimitive.Trigger
    data-slot="select-trigger"
    data-size={size}
    aria-invalid={invalid || undefined}
    className={mergeClass([fieldTriggerClass, fieldTriggerSize[size]], className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon className="flex"><Icon icon={ChevronSort}/></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}

/** The chosen label, or the placeholder in text-3. A block, so a long label ends in an ellipsis. */
function SelectValue({className, ...props}: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className={mergeClass('block min-w-0 flex-1 truncate data-placeholder:text-text-3', className)} {...props}/>;
}

type SelectContentProps = SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger' | 'collisionAvoidance'> & {
  /** sm: 28px rows in the 12px label, for a select opened from a small trigger. */
  size?: 'default' | 'sm';
};

function SelectContent({className, children, side = 'bottom', sideOffset = 6, align = 'start', alignOffset = 0, alignItemWithTrigger = false, collisionAvoidance, size = 'default', ...props}: SelectContentProps) {
  const container = useGlazePortal();
  return <SelectPrimitive.Portal container={container}>
    <SelectPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} alignItemWithTrigger={alignItemWithTrigger} collisionPadding={8} collisionAvoidance={collisionAvoidance} className="isolate z-(--z-overlay) outline-none">
      <SelectPrimitive.Popup
        data-slot="select-content"
        data-size={size}
        // The list recipe, but the list scrolls inside, between the scroll arrows, not the popup.
        className={mergeClass([menuPopupClass, 'min-w-(--anchor-width) max-w-[min(var(--popover),var(--available-width))] overflow-hidden p-0'], className)}
        {...props}
      >
        <SelectScrollUpButton/>
        <SelectPrimitive.List className="max-h-[min(var(--popup-max),var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1">{children}</SelectPrimitive.List>
        <SelectScrollDownButton/>
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>;
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props}/>;
}

function SelectLabel({className, ...props}: SelectPrimitive.GroupLabel.Props) {
  return <SelectPrimitive.GroupLabel data-slot="select-label" className={mergeClass([menuLabelClass, 'ps-7'], className)} {...props}/>;
}

/** One option: the label after a 28px column that holds the check once it is chosen. */
function SelectItem({className, children, ...props}: SelectPrimitive.Item.Props) {
  return <SelectPrimitive.Item data-slot="select-item" className={mergeClass([menuItemClass, 'ps-7'], className)} {...props}>
    <SelectPrimitive.ItemIndicator render={<span className="pointer-events-none absolute start-2 flex size-(--icon) items-center justify-center [&_svg]:text-text-1!"/>}>
      <Icon icon={Check}/>
    </SelectPrimitive.ItemIndicator>
    <SelectPrimitive.ItemText className="block min-w-0 flex-1 truncate">{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>;
}

function SelectSeparator({className, ...props}: SelectPrimitive.Separator.Props) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={mergeClass(menuSeparatorClass, className)} {...props}/>;
}

const arrowClass = 'z-(--z-raised) flex h-(--menu-row-sm) w-full shrink-0 cursor-default items-center justify-center bg-paper text-text-3 [&_svg]:size-(--icon)';

function SelectScrollUpButton({className, ...props}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return <SelectPrimitive.ScrollUpArrow data-slot="select-scroll-up" className={mergeClass(['top-0', arrowClass], className)} {...props}><Icon icon={ChevronUp}/></SelectPrimitive.ScrollUpArrow>;
}

function SelectScrollDownButton({className, ...props}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return <SelectPrimitive.ScrollDownArrow data-slot="select-scroll-down" className={mergeClass(['bottom-0', arrowClass], className)} {...props}><Icon icon={ChevronDown}/></SelectPrimitive.ScrollDownArrow>;
}

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  /** 26, 32 or 36px tall. */
  size?: SelectSize;
};

/** The platform select on the field pill. Prefer `<Select native items/>`; this is the free-form part. */
function NativeSelect({className, size = 'default', ...props}: NativeSelectProps) {
  const primitive = props as unknown as Omit<InputPrimitive.Props, 'className' | 'size'>;
  return <div data-slot="native-select" data-size={size} className={cn('group/native relative w-full min-w-0', className)}>
    <InputPrimitive
      data-slot="native-select-control"
      render={<select/>}
      className={cn(
        fieldTriggerClass, fieldTriggerSize[size],
        // The platform's own arrow goes; the caret below takes its place, 12px from the end.
        'cursor-pointer appearance-none pe-8 disabled:cursor-not-allowed disabled:border-line-faint disabled:bg-field disabled:text-text-disabled',
        '[&>option]:bg-paper [&>option]:text-text-1',
      )}
      {...primitive}
    />
    <Icon icon={ChevronSort} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-text-3 group-has-disabled/native:text-text-disabled"/>
  </div>;
}

export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue,
  NativeSelect, fieldTriggerClass, fieldTriggerSize,
  type NativeSelectProps, type SelectItemDef, type SelectProps, type SelectSize,
};
