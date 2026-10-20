import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's panel: the white surface (styles.css, panel) on its own. Paper, a 1px --line-faint edge, the 11px corner.
// It is the inside of a card: a Card wraps its body in one, and a Card holding Panels as direct children uses those
// instead, so one shell can carry two panels 3px apart (a prompt above its output). Alone on the page it holds a list
// or a short group of rows, with padding="none" so the rows run to its edge and split on rule-row.
//
// Never a Panel inside a Card's panel or inside another Panel: that is a box in a box, two edges where one closes
// the group. Rows inside take rule-row; the last one drops it, because the panel's edge is right below.

const panelVariants = cva('panel relative flex min-w-0 flex-col text-text-1 forced-colors:border-[CanvasText]', {
  variants: {
    padding: {
      default: 'p-3',
      none: 'p-0',
    },
  },
  defaultVariants: {padding: 'default'},
});

type PanelProps = React.ComponentProps<'div'> & VariantProps<typeof panelVariants>;

function Panel({className, padding = 'default', ...props}: PanelProps) {
  return <div data-slot="panel" data-padding={padding} className={cn(panelVariants({padding}), className)} {...props}/>;
}

export {Panel, panelVariants, type PanelProps};
