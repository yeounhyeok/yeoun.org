export type TaxonomyNode = {
	name: string;
	kind?: "category" | "tag" | "group";
	children?: TaxonomyNode[];
};

// Sidebar-friendly taxonomy for yeoun.org.
// Rule: category = "대분류 / 중분류", tags = tools/topics/projects.
// The sidebar is a portfolio layer map, not a full tool inventory.
export const taxonomyTree: TaxonomyNode[] = [
	{
		name: "DevOps",
		children: [
			{ name: "Infrastructure", kind: "category" },
			{ name: "Automation", kind: "category" },
			{ name: "Observability", kind: "category" },
			{ name: "Kubernetes", kind: "category" },
			{ name: "Troubleshooting", kind: "category" },
		],
	},
	{
		name: "Architecture",
		children: [
			{ name: "Homelab", kind: "category" },
			{ name: "Hybrid Cloud", kind: "group" },
			{ name: "Network", kind: "group" },
			{ name: "Security / Access", kind: "group" },
			{ name: "Troubleshooting", kind: "category" },
		],
	},
	{
		name: "AI Platform",
		children: [
			{ name: "Agents", kind: "category" },
			{ name: "Open Source", kind: "category" },
			{ name: "RAG", kind: "group" },
			{ name: "Multi-agent", kind: "group" },
			{ name: "Troubleshooting", kind: "category" },
		],
	},
	{
		name: "MLOps",
		children: [
			{ name: "Model Serving", kind: "category" },
			{ name: "GPU Workspace", kind: "category" },
			{ name: "Evaluation", kind: "group" },
			{ name: "Troubleshooting", kind: "category" },
		],
	},
	{
		name: "Research",
		children: [
			{ name: "Vision AI", kind: "category" },
			{ name: "3D Gaussian Splatting", kind: "category" },
			{ name: "Physical AI / VLA", kind: "category" },
			{ name: "Computer Vision", kind: "group" },
			{ name: "Troubleshooting", kind: "category" },
		],
	},
	{
		name: "Software Engineering",
		children: [
			{ name: "Backend", kind: "category" },
			{ name: "API", kind: "group" },
			{ name: "Languages", kind: "group" },
			{ name: "Troubleshooting", kind: "category" },
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
