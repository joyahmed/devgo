import Button from './Button';
import Drawer from './Drawer';

// what each status means to the person clicking
const STATUS: Record<SetupFileStatus, { word: string; tone: string }> = {
	missing: { word: 'will be installed', tone: 'text-accent' },
	same: { word: 'already there', tone: 'text-text-muted' },
	differs: { word: 'yours, kept as it is', tone: 'text-text-secondary' }
};

// set up this box: the plan as a sheet under the title bar, one line per
// carried file with what the confirm will do to it, and the two buttons.
// a file that is on the box and differs is never overwritten: delete it
// there first if the shipped one is wanted
const SetupSheet = ({ setup }: SetupSheetProps) => {
	const { request, busy, confirm, close } = setup;
	const plan = request?.plan ?? null;
	const count = plan?.files.filter(f => f.install).length ?? 0;
	const actions: {
		label: string;
		variant: ButtonVariant;
		disabled?: boolean;
		onClick: () => void;
	}[] = [
		{ label: 'Cancel', variant: 'secondary', disabled: busy, onClick: close },
		{
			label:
				busy && plan
					? 'Installing…'
					: count === 0
						? 'Nothing to install'
						: `Install ${count} file${count === 1 ? '' : 's'}`,
			variant: 'primary',
			disabled: busy || count === 0,
			onClick: () => confirm()
		}
	];

	return (
		<Drawer
			{...{
				open: request !== null,
				side: 'top' as const,
				title: request ? `Set up ${request.server.name}` : '',
				onClose: close,
				z: 50 as const
			}}
		>
			<p className="text-15 text-text-secondary mb-4">
				DevGo carries the three files of the server contract. They go in{' '}
				<span className="font-mono">{plan?.dir ?? '~/scripts'}</span> on{' '}
				{request?.server.name}, as the user you ssh in as; then the row lists the apps on
				the box.
			</p>
			{plan ? (
				<ul className="mb-6 font-mono text-13 flex flex-col gap-1">
					{plan.files.map(f => (
						<li key={f.name} className="flex items-baseline gap-3">
							<span className="text-text-primary">{f.name}</span>
							<span className="text-text-muted text-11">
								{Math.round(f.bytes / 1024)} KB
							</span>
							<span className={`${STATUS[f.status].tone} font-sans text-13`}>
								{STATUS[f.status].word}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="mb-6 text-13 text-text-muted">Looking at the box…</p>
			)}
			<div className="flex justify-end gap-3">
				{actions.map(({ label, ...button }) => (
					<Button key={label} {...button}>
						{label}
					</Button>
				))}
			</div>
		</Drawer>
	);
};

export default SetupSheet;
