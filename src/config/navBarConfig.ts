import {
	LinkPreset,
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/config";
import { siteConfig } from "./siteConfig";

// 根据页面开关动态生成导航栏配置
const getDynamicNavBarConfig = (): NavBarConfig => {
	// 基础导航栏链接
	const links: (NavBarLink | LinkPreset)[] = [
		// 主页
		LinkPreset.Home,

		// 归档
		LinkPreset.Archive,
	];

	// 友链
	links.push(LinkPreset.Friends);


	// 根据配置决定是否添加留言板，在siteConfig关闭pages.guestbook时导航栏不显示留言板
	if (siteConfig.pages.guestbook) {
		links.push(LinkPreset.Guestbook);
	}

	// 根据配置决定是否添加番组计划，在siteConfig关闭pages.bangumi时导航栏不显示番组计划
	if (siteConfig.pages.bangumi) {
		links.push(LinkPreset.Bangumi);
	}

		// 自定义导航栏链接,并且支持多级菜单
	links.push({
		name: "小工具",
		url: "/links/",
		icon: "material-symbols:build",

		// 子菜单
		children: [
			{
				name: "临时邮件",
				url: "https://mail.whgd.eu.org/",
				external: true,
				icon: "material-symbols:mail-outline",
			},
			{
				name: "图床",
				url: "https://picture.whgd.eu.org/",
				external: true,
				icon: "material-symbols:image-outline",
			},
			{
				name: "拼豆",
				url: "https://pindou.whgd.eu.org/",
				external: true,
				icon: "material-symbols:apps",
			},
			{
				name: "MoonTV",
				url: "https://moontv.whgd.eu.org/",
				external: true,
				icon: "material-symbols:tv-outline",
			},
			{
				name: "订阅转换",
				url: "https://sublink.whgd.eu.org/",
				external: true,
				icon: "material-symbols:sync-alt",
			},
		],
	});

	// 根据配置决定是否添加赞助，在siteConfig关闭pages.sponsor时导航栏不显示赞助
	if (siteConfig.pages.sponsor) {
		links.push(LinkPreset.Sponsor);
	}

	// 仅返回链接，其它导航搜索相关配置在模块顶层常量中独立导出
	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
