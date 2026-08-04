/** Shared storyboard scene contract consumed by authoring tools and renderers. */
export interface StoryboardScene {
	number: number;
	title: string;
	duration: string;
	visual: string;
	audio?: string;
	transition?: string;
	highlight?: string;
}
