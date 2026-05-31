export type TaxonomyNode = {
	name: string;
	kind?: "category" | "tag" | "group";
	children?: TaxonomyNode[];
};

// Sidebar-friendly taxonomy: keep only broad layer/topic nodes.
// Concrete tool names such as Terraform, WireGuard, YOLO, etc. remain as post tags,
// but are intentionally not expanded here to keep the left category tree readable.
export const taxonomyTree: TaxonomyNode[] = [
	{
		name: "DevOps",
		children: [
			{ name: "Infrastructure", kind: "category" },
			{ name: "Observability", kind: "category" },
			{ name: "Automation", kind: "category" },
		],
	},
	{
		name: "Architecture",
		children: [
			{ name: "Homelab", kind: "category" },
			{ name: "Hybrid Cloud Architecture", kind: "tag" },
			{ name: "Network", kind: "group" },
			{ name: "DB Hub / SSoT", kind: "group" },
			{ name: "Self-hosted Services", kind: "group" },
		],
	},
	{
		name: "AI Platform",
		children: [
			{ name: "Agents", kind: "category" },
			{ name: "Personal Agent Runtime", kind: "group" },
			{ name: "Open-source Agents", kind: "group" },
			{ name: "RAG / Campus Agent", kind: "group" },
			{ name: "Multi-agent Workflows", kind: "group" },
		],
	},
	{
		name: "MLOps",
		children: [
			{ name: "Model Serving", kind: "category" },
			{ name: "Local LLM Lab", kind: "group" },
			{ name: "Serving API", kind: "group" },
		],
	},
	{
		name: "Research",
		children: [
			{ name: "Vision AI", kind: "category" },
			{ name: "3D Gaussian Splatting", kind: "tag" },
			{ name: "Physical AI / VLA", kind: "tag" },
			{ name: "Computer Vision", kind: "group" },
		],
	},
	{
		name: "Software Engineering",
		children: [
			{ name: "Backend", kind: "category" },
			{ name: "Languages", kind: "group" },
			{ name: "API / Messaging", kind: "group" },
		],
	},
	{
		name: "Algorithms",
		children: [
			{ name: "Problem Solving", kind: "category" },
			{ name: "Dynamic Programming", kind: "tag" },
			{ name: "Graph", kind: "tag" },
			{ name: "BOJ", kind: "tag" },
		],
	},
];
