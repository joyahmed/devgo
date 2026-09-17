import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { relativeTime } from '../github';
import Button from './Button';
import RefreshIcon from './RefreshIcon';

const WIDTH = 320;
// the sparkline's box; the strokes keep a stroke's width off each edge
const W = 288;
const H = 40;
const PAD = 2;

const dayLabel = (iso: string) =>
	new Date(iso).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});

// one series as a polyline over the day list: index across, count up,
// both lines on the one scale so unique never rises above total
const line = (days: TrafficDay[], key: 'count' | 'uniques', max: number) =>
	days
		.map((d, i) => {
			const x =
				days.length > 1 ? PAD + (i * (W - 2 * PAD)) / (days.length - 1) : W / 2;
			const y = H - PAD - (max > 0 ? (d[key] / max) * (H - 2 * PAD) : 0);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');

// a stat tile: the totals as the headline, fourteen days as two strokes
// of the one accent (total solid, unique dashed and lighter), the last
// day's count as text at the end. no axis: the number says the scale
const TrafficTile = ({ label, series }: TrafficTileProps) => {
	const { days } = series;
	const max = Math.max(0, ...days.map(d => d.count));
	const last = days[days.length - 1];
	const step = days.length > 1 ? (W - 2 * PAD) / (days.length - 1) : W;
	return (
		<div className='flex flex-col gap-1'>
			<div className='flex items-baseline justify-between'>
				<span className='text-11 text-text-muted'>{label}</span>
				<span className='text-11 text-text-muted'>14 days</span>
			</div>
			<div className='flex items-baseline gap-1.5'>
				<span className='text-18 font-semibold text-text-primary'>
					{series.count}
				</span>
				<span className='text-13 text-text-secondary'>
					· {series.uniques} unique
				</span>
			</div>
			<div className='flex items-center gap-2'>
				<svg
					width={W}
					height={H}
					viewBox={`0 0 ${W} ${H}`}
					className='shrink-0 text-accent'
					role='img'
					aria-label={`${label} by day, ${days.length} days`}
				>
					{days.length > 0 && (
						<>
							<polyline
								points={line(days, 'uniques', max)}
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								strokeDasharray='3 3'
								strokeLinejoin='round'
								strokeLinecap='round'
								opacity='0.5'
							/>
							<polyline
								points={line(days, 'count', max)}
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								strokeLinejoin='round'
								strokeLinecap='round'
							/>
							{/* the hover layer: one band per day, its title the values */}
							{days.map((d, i) => (
								<rect
									key={d.timestamp}
									x={days.length > 1 ? PAD + i * step - step / 2 : 0}
									y={0}
									width={days.length > 1 ? step : W}
									height={H}
									fill='transparent'
								>
									<title>
										{`${dayLabel(d.timestamp)} · ${d.count} ${label.toLowerCase()} · ${d.uniques} unique`}
									</title>
								</rect>
							))}
						</>
					)}
				</svg>
				{last && (
					<span
						className='font-mono text-11 text-text-muted shrink-0 w-6 text-right'
						title={`${dayLabel(last.timestamp)}, the last day counted`}
					>
						{last.count}
					</span>
				)}
			</div>
		</div>
	);
};

// the 14-day traffic of one github row, the numbers only its owner is
// shown: two tiles, one legend for both, then the referrers. anchored
// where the menu was, or at the top when the palette asked
const TrafficPopover = ({ traffic }: TrafficPopoverProps) => {
	const { popover, byRepo, loading, refresh, close } = traffic;
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const away = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) close();
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		window.addEventListener('mousedown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', esc);
		};
	}, [close]);

	const x = popover?.x ?? (window.innerWidth - WIDTH) / 2;
	const y = popover?.y ?? 88;
	// clamp with the measured height once it has mounted, as the menu does
	const [top, setTop] = useState(y);
	const data = popover ? byRepo.get(popover.repo.full_name) : undefined;
	useLayoutEffect(() => {
		const h = ref.current?.getBoundingClientRect().height ?? 0;
		setTop(Math.max(8, Math.min(y, window.innerHeight - 8 - h)));
	}, [y, data]);

	if (!popover) return null;
	const { repo } = popover;
	const busy = loading.has(repo.full_name);
	const tiles = data
		? [
				{ label: 'Views', series: data.views },
				{ label: 'Clones', series: data.clones }
			]
		: [];

	return (
		<div
			ref={ref}
			className='fixed z-50 bg-bg-secondary border border-border rounded-panel shadow-surface p-4 flex flex-col gap-4 text-15'
			style={{
				top,
				left: Math.max(8, Math.min(x, window.innerWidth - 8 - WIDTH)),
				width: WIDTH,
				maxHeight: window.innerHeight - 16
			}}
			onContextMenu={e => e.preventDefault()}
		>
			<div className='flex items-center gap-2 min-w-0'>
				<span className='font-mono text-13 text-text-primary truncate'>
					{repo.full_name}
				</span>
				<span className='text-11 text-text-muted shrink-0'>traffic</span>
				<span className='flex-1' />
				{data && (
					<span
						className='text-11 text-text-muted shrink-0'
						title='When these numbers were read from GitHub'
					>
						{relativeTime(data.fetched_at)}
					</span>
				)}
				<Button
					variant='ghost'
					title='Read again from GitHub (gh api)'
					disabled={busy}
					onClick={refresh}
				>
					<RefreshIcon spinning={busy} size={13} />
				</Button>
			</div>
			{!data && (
				<div className='text-13 text-text-muted'>
					{busy ? 'Reading traffic…' : 'Nothing read yet'}
				</div>
			)}
			{tiles.map(t => (
				<TrafficTile key={t.label} {...t} />
			))}
			{data && (
				<div className='flex items-center gap-4 text-11 text-text-muted'>
					{[
						{ key: 'total', dash: undefined, o: 1 },
						{ key: 'unique', dash: '3 3', o: 0.5 }
					].map(k => (
						<span key={k.key} className='flex items-center gap-1.5'>
							<svg width='18' height='6' className='text-accent'>
								<line
									x1='1'
									y1='3'
									x2='17'
									y2='3'
									stroke='currentColor'
									strokeWidth='2'
									strokeDasharray={k.dash}
									strokeLinecap='round'
									opacity={k.o}
								/>
							</svg>
							{k.key}
						</span>
					))}
				</div>
			)}
			{data && (
				<div className='flex flex-col gap-1 min-w-0'>
					<span className='text-11 text-text-muted'>Referrers</span>
					{data.referrers.length === 0 && (
						<span className='text-13 text-text-muted'>None in 14 days</span>
					)}
					{data.referrers.map(r => (
						<div
							key={r.referrer}
							className='flex items-center gap-3 text-13'
							title={`${r.count} views · ${r.uniques} unique visitors from ${r.referrer}`}
						>
							<span className='truncate text-text-primary'>{r.referrer}</span>
							<span className='flex-1' />
							<span className='font-mono text-11 text-text-muted shrink-0'>
								{r.count} · {r.uniques}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export default TrafficPopover;
