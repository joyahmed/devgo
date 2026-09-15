const LABELS: Record<RuntimeInfo['runtime'], string> = {
	windows: 'Windows',
	wsl: 'WSL'
};

const RuntimeIndicator = ({ runtime }: RuntimeIndicatorProps) => (
	<span className='inline-block px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel text-accent border border-border'>
		{LABELS[runtime]}
	</span>
);

export default RuntimeIndicator;
