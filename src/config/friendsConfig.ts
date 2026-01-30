import type { FriendLink, FriendsPageConfig } from "../types/config";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 显示列数：2列或3列
	columns: 2,
};

// 友链配置
export const friendsConfig: FriendLink[] = [
	{
		title: "一只兔",
		imgurl: "https://picture.whgd.eu.org/file/1769758266266_avatar.webp",
		desc: "欲买桂花同载酒，终不似，少年游。",
		siteurl: "https://whgd.eu.org/",
		tags: ["Blog", "技术", "生活"],
		weight: 10, // 权重，数字越大排序越靠前
		enabled: true, // 是否启用
	},

];

// 获取启用的友链并按权重排序
export const getEnabledFriends = (): FriendLink[] => {
	return friendsConfig
		.filter((friend) => friend.enabled)
		.sort((a, b) => b.weight - a.weight);
};
