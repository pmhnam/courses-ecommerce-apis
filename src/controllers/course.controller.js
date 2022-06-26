const CourseModel = require('../models/courses/course.model');
const ChapterModel = require('../models/courses/chapter.model');
const LessonModel = require('../models/courses/lesson.model');
const RateModel = require('../models/courses/rate.model');
const CommentModel = require('../models/courses/comment.model');
const HistorySearchModel = require('../models/users/historySearch.model');
const HistoryViewModel = require('../models/users/historyView.model');
const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId;
const didYouMean = require('google-did-you-mean')
const helper = require('../helper');
const MyCourseModel = require('../models/users/myCourse.model');
var fs = require('fs');




//#region  courses

//fn: Thêm khoá học
const postCourse = async (req, res, next) => {
    try {
        const author = req.user
        const account = req.account
        const image = req.file
        const { name, category, description, lang, intendedLearners, requirements, targets, level, currentPrice, originalPrice, hashtags = [] } = req.body
        // // tags is array
        if (account.role != 'teacher') {
            return res.status(401).json({ message: "Not permited" })
        }
        // xác thực dữ liệu
        if (currentPrice && parseInt(currentPrice) < 0) {
            return res.status(400).json({ message: "currentPrice phải lớn hơn hoặc bằng 0" })
        }
        if (originalPrice && parseInt(originalPrice) < 0) {
            return res.status(400).json({ message: "originalPrice phải lớn hơn hoặc bằng 0" })
        }
        if (originalPrice && currentPrice && parseInt(originalPrice) < parseInt(currentPrice)) {
            return res.status(400).json({ message: "originalPrice phải lớn hơn hoặc bằng currentPrice" })
        }

        // tính giảm giá
        let saleOff = (1 - parseInt(currentPrice) / parseInt(originalPrice)) * 100 || 0
        // upload image lên cloud
        let thumbnail = await helper.uploadImageToCloudinary(image, name)
        // tạo khoá học
        const course = await CourseModel.create(
            { name, category, description, currentPrice, originalPrice, saleOff, author, thumbnail, lang, intendedLearners, requirements, targets, level, hashtags }
        )
        if (course) {
            const chapter = await ChapterModel.create({ course, name: "Default", number: 1 })
            await LessonModel.create({
                chapter,
                number: 1,
                title: "Default"
            })
        }
        res.status(201).json({ message: "ok" })
        try {
            fs.unlinkSync(image.path);
        } catch (error) {

        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "error 1" })
    }
}

// fn: Cập nhật khoá học: (thêm markdown cho description)
// Note: không cho phép cập nhật sellNumber, teacher không được phép cập nhật publish
const putCourse = async (req, res, next) => {
    try {
        const user = req.user
        const image = req.file
        const account = req.account
        const { slug } = req.params
        var newCourse = req.body

        // lấy thông tin hiện tại
        const course = await CourseModel.findOne({ slug }).lean()
        if (!course) return res.status(404).json({ message: "Course not found!" })
        if (image) {
            // upload image lên cloud
            let thumbnail = await helper.uploadImageToCloudinary(image, slug)
            newCourse.thumbnail = thumbnail
        }
        // tránh hacker
        if (newCourse.sellNumber) {
            delete newCourse.sellNumber
        }
        // chỉ cho phép admin cập nhật publish
        if (newCourse.publish) {
            if (account.role == "admin") {
                newCourse.publish = JSON.stringify(newCourse.publish) == "true"
            } else {
                delete newCourse.publish
            }
        }

        // check permit 
        if (account.role !== "admin" && JSON.stringify(user._id) !== JSON.stringify(course.author)) {
            return res.status(401).json({ message: "not permited" })
        }

        if (newCourse.currentPrice || newCourse.originalPrice) {
            let cp = newCourse.currentPrice || course.currentPrice
            let op = newCourse.originalPrice || course.originalPrice
            newCourse.saleOff = (1 - parseInt(cp) / parseInt(op)) * 100 || 0
        }

        // cập nhật theo id
        await CourseModel.updateOne({ _id: course._id }, newCourse)
        res.status(200).json({ message: 'ok' })
        try {
            fs.unlinkSync(image.path);
        } catch (error) {
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}


// fn: Lấy tất cả khoá học và phân trang
// ex: ?sort=score&name=api&category=web-development&price=10-50&hashtags=nodejs-mongodb&rating=4.5
const getCourses = async (req, res, next) => {
    try {
        const { user } = req
        var { page = 1, limit = 10, sort, name, category, price, hashtags, rating, level, publish = 'true', status } = req.query
        const nSkip = (parseInt(page) - 1) * parseInt(limit)
        let searchKey = await didYouMean(name) || null
        let aCountQuery = [
            { $match: { publish: publish == 'true' } },
            {
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            {
                // tính rate trung bình
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} }
                            }
                        }
                    ],
                    as: 'rating'
                }
            },
        ]
        // aggrate query
        let aQuery = [
            { $match: { publish: publish == 'true' } },
            {
                // tính rate trung bình
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} }
                            }
                        }
                    ],
                    as: 'rating'
                }
            },
            {
                $unwind: {
                    "path": "$rating",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'author'
                }
            },
            {
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            {
                $unwind: "$author"
            },
            {
                $unwind: {
                    "path": "$category",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                $project: {
                    'slug': 1,
                    'name': 1,
                    'category._id': 1,
                    'category.name': 1,
                    'category.slug': 1,
                    'thumbnail': 1,
                    'description': 1,
                    'language': 1,
                    'intendedLearners': 1,
                    'requirements': 1,
                    'targets': 1,
                    'level': 1,
                    'currentPrice': 1,
                    'originalPrice': 1,
                    'saleOff': 1,
                    'author._id': 1,
                    'author.fullName': 1,
                    'sellNumber': 1,
                    'hashtags': 1,
                    'type': 1,
                    'rating.rate': 1,
                    'rating.numOfRate': 1,
                    'createdAt': {
                        $dateToString: {
                            date: "$createdAt",
                            format: '%Y-%m-%dT%H:%M:%S',
                            timezone: "Asia/Ho_Chi_Minh"
                        }
                    },
                    'updatedAt': {
                        $dateToString: {
                            date: "$updatedAt",
                            format: '%Y-%m-%dT%H:%M:%S',
                            timezone: "Asia/Ho_Chi_Minh"
                        }
                    },
                    'status': 1,
                    //'score': { $meta: "textScore" },
                }
            },
            { $skip: nSkip },
            { $limit: parseInt(limit) }
        ]
        // tìm theo tên
        if (name) {
            // nếu người dùng đã đăng nhập thì lưu lịch sử tìm kiếm (chỉ lưu 10 lần gần nhất)
            if (req.user) {
                await HistorySearchModel.findOneAndUpdate(
                    { user: req.user._id },
                    {
                        $push: {
                            historySearchs: {
                                $each: [name],
                                $position: 0,
                                $slice: 10
                            }
                        }
                    },
                    { upsert: true }
                )
            }
            if (searchKey.suggestion) {
                searchKey.original = name
                name = searchKey.suggestion
            }
            aQuery.unshift({
                $match: { $text: { $search: name } }
            })
            aCountQuery.unshift({
                $match: { $text: { $search: name } }
            })
        }
        // tìm theo số đánh giá
        if (rating) {
            aQuery.push({
                $match: { "rating.rate": { $gte: parseFloat(rating) } }
            })
            aCountQuery.push({
                $match: { "rating.rate": { $gte: parseFloat(rating) } }
            })
        }
        // tìm theo keyword
        if (hashtags) {
            aQuery.push({
                $match: { hashtags: { $all: hashtags.split("-") } }
            })
            aCountQuery.push({
                $match: { hashtags: { $all: hashtags.split("-") } }
            })
        }
        // tìm theo category slug
        if (category) {
            aQuery.push(
                { $match: { 'category.slug': category } }
            )
            aCountQuery.push(
                { $match: { 'category.slug': category } }
            )
        }
        // tìm status
        if (status) {
            aQuery.push(
                { $match: { status } }
            )
            aCountQuery.push(
                { $match: { status } }
            )
        }
        // tìm theo level
        if (level) {
            aQuery.push(
                { $match: { level: level } }
            )
            aCountQuery.push(
                { $match: { level: level } }
            )
        }
        // tìm theo giá từ min-max
        if (price) {
            let [min, max] = price.split('-')
            min = parseInt(min)
            max = parseInt(max)
            aQuery.push(
                { $match: { $and: [{ currentPrice: { $gt: min } }, { currentPrice: { $lt: max } }] } }
            )
            aCountQuery.push(
                { $match: { $and: [{ currentPrice: { $gt: min } }, { currentPrice: { $lt: max } }] } }
            )
        }
        // sắp xếp và thống kê
        if (sort) {
            let [f, v] = sort.split('-')
            let sortBy = {}
            if (f == 'score') {
                aQuery.push({ $sort: { score: { $meta: "textScore" }, rating: -1 } })
            } else if (f == 'rating') {
                sortBy["rating.rate"] = v == "asc" || v == 1 ? 1 : -1
                aQuery.push({ $sort: sortBy })
            } else {
                sortBy[f] = v == "asc" || v == 1 ? 1 : -1
                aQuery.push({ $sort: sortBy })
            }
        }

        // nếu user đã login => loại những khoá học đã mua
        if (user) {
            let khoaHocDaMuas = await MyCourseModel.find({ user }).lean()
            let exceptIds = khoaHocDaMuas.map(item => item.course)
            aQuery.push({ $match: { _id: { $nin: exceptIds } } })
            aCountQuery.push({ $match: { _id: { $nin: exceptIds } } })
        }

        const courses = await CourseModel.aggregate(aQuery)
        aCountQuery.push({ $count: "total" })
        const totalCourse = await CourseModel.aggregate(aCountQuery)
        let total = totalCourse[0]?.total || 0

        return res.status(200).json({ message: 'ok', searchKey, total, courses })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "error" })
    }
}

// fn: Xem khoá học theo slug
const getCourse = async (req, res, next) => {
    try {
        const { slug } = req.params
        const { user } = req

        const course = await CourseModel.aggregate([
            {
                $match: { slug: slug }
            },
            {   // tính rate trung bình
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} },
                                star5: { $sum: { $cond: [{ $eq: ['$rate', 5] }, 1, 0] } },
                                star4: { $sum: { $cond: [{ $eq: ['$rate', 4] }, 1, 0] } },
                                star3: { $sum: { $cond: [{ $eq: ['$rate', 3] }, 1, 0] } },
                                star2: { $sum: { $cond: [{ $eq: ['$rate', 2] }, 1, 0] } },
                                star1: { $sum: { $cond: [{ $eq: ['$rate', 1] }, 1, 0] } },
                            },
                        }
                    ],
                    as: 'rating'
                }
            },
            {
                $unwind: {
                    "path": "$rating",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'author'
                }
            },
            {
                $unwind: "$author"
            },
            {
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            {
                $unwind: "$category"
            },
            {
                $lookup: {
                    from: 'chapters',
                    localField: '_id',
                    foreignField: 'course',
                    as: 'chapters'
                }
            },
            {
                $unwind: {
                    path: "$chapters",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'lessons',
                    localField: 'chapters._id',
                    foreignField: 'chapter',
                    as: 'chapters.lessons'
                }
            },
            {
                $group: {
                    _id: "$_id",
                    name: { $first: "$name" },
                    slug: { $first: "$slug" },
                    category: { $first: "$category" },
                    thumbnail: { $first: "$thumbnail" },
                    description: { $first: "$description" },
                    lang: { $first: "$lang" },
                    intendedLearners: { $first: "$intendedLearners" },
                    requirements: { $first: "$requirements" },
                    targets: { $first: "$targets" },
                    level: { $first: "$level" },
                    currentPrice: { $first: "$currentPrice" },
                    originalPrice: { $first: "$originalPrice" },
                    saleOff: { $first: "$saleOff" },
                    rating: { $first: "$rating" },
                    author: { $first: "$author" },
                    hashtags: { $first: "$hashtags" },
                    publish: { $first: "$publish" },
                    status: { $first: "$status" },
                    chapters: { $push: "$chapters" },
                    createdAt: { $first: "$createdAt" },
                    type: { $first: "$type" },
                }
            },
            {
                $project: {
                    'slug': 1,
                    'name': 1,
                    'category._id': 1,
                    'category.name': 1,
                    'category.slug': 1,
                    'thumbnail': 1,
                    'description': 1,
                    'lang': 1,
                    'intendedLearners': 1,
                    'requirements': 1,
                    'targets': 1,
                    'level': 1,
                    'currentPrice': 1,
                    'originalPrice': 1,
                    'saleOff': 1,
                    'sellNumber': 1,
                    'rating.rate': 1,
                    'rating.numOfRate': 1,
                    'rating.star5': 1,
                    'rating.star4': 1,
                    'rating.star3': 1,
                    'rating.star2': 1,
                    'rating.star1': 1,
                    'author._id': 1,
                    'author.fullName': 1,
                    'hashtags': 1,
                    'publish': 1,
                    'type': 1,
                    'status': 1,
                    'createdAt': {
                        $dateToString: {
                            date: "$createdAt",
                            format: '%Y-%m-%dT%H:%M:%S',
                            timezone: "Asia/Ho_Chi_Minh"
                        }
                    },
                    'chapters': { _id: 1, number: 1, name: 1, lessons: { _id: 1, number: 1, title: 1, description: 1 } },
                }
            },
        ])
        if (course[0]) {
            if (user) {
                const myCourse = await MyCourseModel.findOne({ user, course: course[0] }).lean()
                if (myCourse) {
                    course[0].isBuyed = true
                }
            }
            if (!course[0].chapters[0].name) { course[0].chapters = [] }
            res.status(200).json({ message: 'ok', course: course[0] })
        } else {
            res.status(404).json({ message: 'mã khoá học không tồn tại' })
        }
        // lưu lịch sử xem
        if (user && course[0]) {
            await HistoryViewModel.findOneAndUpdate(
                { user: req.user._id },
                {
                    $push: {
                        historyViews: {
                            $each: [course[0]._id],
                            $position: 0,
                            $slice: 10
                        }
                    }
                },
                { upsert: true }
            )
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}

// fn: Xem danh sách khoá học liên quan theo slug (category, hashtags, rating)
const getRelatedCourses = async (req, res, next) => {
    try {
        const { slug } = req.params
        const { page = 1, limit = 12 } = req.query
        // course
        const course = await CourseModel.findOne({ slug: slug }).lean()
        // tìm khoá học liên quan theo hasgtag
        const courses = await CourseModel.aggregate([
            {
                $match: {
                    $and: [
                        { category: course.category },
                        { _id: { $ne: ObjectId(course._id) } },
                        { publish: true },
                    ]
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'author'
                }
            },
            {
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$author' },
            { $unwind: '$category' },
            {
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} }
                            }
                        }
                    ],
                    as: 'rating'
                }
            },
            {
                $sort: { rating: -1 }
            },
            {
                $limit: parseInt(limit)
            },
            {
                $skip: (parseInt(page) - 1) * parseInt(limit)
            }
        ])
        const totalCount = await CourseModel.aggregate([
            {
                $match: {
                    $and: [
                        { hashtags: { $in: course.hashtags } },
                        { _id: { $ne: ObjectId(course._id) } },
                        { publish: true },
                    ]
                }
            }, {
                $count: 'total'
            }
        ])
        let total = totalCount[0]?.total || 0
        return res.status(200).json({ message: 'ok', total, courses })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}


// fn: gợi ý khoá học 
const getSuggestCourses = async (req, res, next) => {
    try {
        // lấy lịch sử tìm kiếm
        // xem tag nào nhiều nhất => course có tag đó
        const { limit = 10 } = req.query
        const user = req.user
        let searchKey = {}
        var courses = []
        var keyword = ''
        var query = [
            {
                // tính rate trung bình
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} }
                            }
                        }
                    ],
                    as: 'rating'
                }
            },
            {
                $unwind: {
                    "path": "$rating",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'author'
                }
            },
            {
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            {
                $unwind: "$author"
            },
            {
                $unwind: {
                    "path": "$category",
                    "preserveNullAndEmptyArrays": true
                }
            },
            {
                $project: {
                    'slug': 1,
                    'name': 1,
                    'category._id': 1,
                    'category.name': 1,
                    'category.slug': 1,
                    'thumbnail': 1,
                    'description': 1,
                    'language': 1,
                    'intendedLearners': 1,
                    'requirements': 1,
                    'targets': 1,
                    'level': 1,
                    'currentPrice': 1,
                    'originalPrice': 1,
                    'saleOff': 1,
                    'author._id': 1,
                    'author.fullName': 1,
                    'sellNumber': 1,
                    'hashtags': 1,
                    'type': 1,
                    'rating.rate': 1,
                    'rating.numOfRate': 1,
                    'createdAt': {
                        $dateToString: {
                            date: "$createdAt",
                            format: '%Y-%m-%dT%H:%M:%S',
                            timezone: "Asia/Ho_Chi_Minh"
                        }
                    },
                    'updatedAt': {
                        $dateToString: {
                            date: "$updatedAt",
                            format: '%Y-%m-%dT%H:%M:%S',
                            timezone: "Asia/Ho_Chi_Minh"
                        }
                    },
                    'status': 1,
                    //'score': { $meta: "textScore" },
                }
            },
            { $limit: parseInt(limit) }
        ]
        if (user) {
            // nếu có user
            if (user) {
                let khoaHocDaMuas = await MyCourseModel.find({ user }).lean()
                let exceptIds = khoaHocDaMuas.map(item => item.course)
                query.unshift({ $match: { _id: { $nin: exceptIds } } })
            }
            // lấy first recent search
            const historySearchOfUser = await HistorySearchModel.findOne({ user: user._id }).lean()
            keyword = historySearchOfUser ? historySearchOfUser.historySearchs[0] : null
            if (keyword) {
                searchKey = await didYouMean(keyword)
                if (searchKey.suggestion) {
                    searchKey.original = keyword
                    keyword = searchKey.suggestion
                }
                query.unshift({
                    $match: { $text: { $search: keyword }, publish: true }
                })
                // tìm khoá học liên quan lịch sử tìm kiếm
                courses = await CourseModel.aggregate(query)
            } else {
                let historyViews = await HistoryViewModel.findOne({ user }).lean()
                let courseId = historyViews?.historyViews[0]
                if (courseId) {
                    req.params.id = courseId
                    courses = await getRelatedCourses(req, res, next)
                    return
                }
            }
        }
        return res.status(200).json({ message: "ok", keyword, courses })

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "error" })
    }
}

// fn: Xem danh sách khoá học hot (sellNumber)
// get /hot?category=slug
const getHotCourses = async (req, res, next) => {
    try {
        const { user } = req
        const { limit = 12, category } = req.query
        let aQuery = []
        if (category) {
            aQuery.unshift({
                $match: { "category.slug": category }
            })
        }
        aQuery.push(
            { $match: { publish: true, type: { $in: ["Hot", 'Bestseller'] } } },
            {
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} }
                            }
                        }
                    ],
                    as: 'rating'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'author'
                }
            },
            {
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$author' },
            { $unwind: '$category' },
            {
                $sort: { sellNumber: -1, rating: -1 }
            },
            {
                $limit: parseInt(limit)
            })

        // nếu user đã login => loại những khoá học đã mua
        if (user) {
            let khoaHocDaMuas = await MyCourseModel.find({ user }).lean()
            let exceptIds = khoaHocDaMuas.map(item => item.course)
            aQuery.unshift({ $match: { _id: { $nin: exceptIds } } })
        }
        const courses = await CourseModel.aggregate(aQuery)
        return res.status(200).json({ message: "ok", courses })

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}


// fn: lấy thông tin đánh giá khoá học và đánh giá của user nếu có
const getRates = async (req, res, next) => {
    try {
        const { page = 1, limit = 10 } = req.query
        const { slug } = req.params
        const { user } = req
        // lấy id khoá học
        const course = await CourseModel.findOne({ slug }).lean()
        if (!course) return res.status(404).json({ message: "Course not found" })
        // lấy thông tin đánh giá khoá học
        const rates = await RateModel.find({ course: course._id })
            .select('-__v -course')
            .populate('author', '_id fullName')
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
        var userRating = null
        if (user) {
            userRating = await RateModel.findOne({ user, course }).lean()
        }
        return res.status(200).json({ message: 'ok', userRating, rates })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}


//fn: xoá khoá học
const deleteCourse = async (req, res, next) => {
    try {
        const { slug } = req.params
        const { account, user } = req

        // kiểm tra khoá học có tồn tại không?
        const course = await CourseModel.findOne({ slug }).lean()
        if (!course) {
            return res.status(400).json({ message: "Mã khoá học không hợp lệ" })
        }
        if (account.role !== 'admin') {
            if (JSON.stringify(user._id) !== JSON.stringify(course.author)) {
                return res.status(400).json({ message: "Not permitted" })
            }
        }

        // kiểm tra khoá học có người mua chưa ?
        const isBuyed = await MyCourseModel.findOne({ course: course._id }).lean()
        if (isBuyed) {
            return res.status(400).json({ message: "Khoá học đã có người mua. Không thể xoá" })
        }

        // xoá khoá học
        await CourseModel.deleteOne({ slug: slug })
        res.status(200).json({ message: "delete ok" })

        let chapters = await ChapterModel.find({ course: course._id }).select("_id").lean()
        chapters = chapters.map(obj => obj._id)
        // xoá chapters và lesson của từng chapter
        await LessonModel.deleteMany({ chapter: { $in: chapters } })
        await ChapterModel.deleteMany({ course: course._id })

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error", error: error.message })
    }
}


//fn: xem khoá học để kiểm duyệt (có cả nội dung bài giảng)
const getDetailPendingCourse = async (req, res, next) => {
    try {
        const { slug } = req.params

        const course = await CourseModel.aggregate([
            {
                $match: { slug: slug }
            },
            {   // tính rate trung bình
                $lookup: {
                    from: 'rates',
                    localField: '_id',
                    foreignField: 'course',
                    pipeline: [
                        {
                            $group: {
                                _id: '$course',
                                rate: { $avg: '$rate' },
                                numOfRate: { $count: {} },
                                star5: { $sum: { $cond: [{ $eq: ['$rate', 5] }, 1, 0] } },
                                star4: { $sum: { $cond: [{ $eq: ['$rate', 4] }, 1, 0] } },
                                star3: { $sum: { $cond: [{ $eq: ['$rate', 3] }, 1, 0] } },
                                star2: { $sum: { $cond: [{ $eq: ['$rate', 2] }, 1, 0] } },
                                star1: { $sum: { $cond: [{ $eq: ['$rate', 1] }, 1, 0] } },
                            },
                        }
                    ],
                    as: 'rating'
                }
            },
            { // unwind rating
                $unwind: {
                    "path": "$rating",
                    "preserveNullAndEmptyArrays": true
                }
            },
            { // lookup user
                $lookup: {
                    from: 'users',
                    localField: 'author',
                    foreignField: '_id',
                    as: 'author'
                }
            },
            { // unwind author
                $unwind: "$author"
            },
            { // lookup categorys
                $lookup: {
                    from: 'categorys',
                    localField: 'category',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { // unwind category
                $unwind: "$category"
            },
            { // lookup chapters
                $lookup: {
                    from: 'chapters',
                    localField: '_id',
                    foreignField: 'course',
                    as: 'chapters'
                }
            },
            {
                $unwind: {
                    path: "$chapters",
                    preserveNullAndEmptyArrays: true
                }
            },
            { // lookup lessons
                $lookup: {
                    from: 'lessons',
                    localField: 'chapters._id',
                    foreignField: 'chapter',
                    as: 'chapters.lessons'
                }
            },
            { // group
                $group: {
                    _id: "$_id",
                    name: { $first: "$name" },
                    slug: { $first: "$slug" },
                    category: { $first: "$category" },
                    thumbnail: { $first: "$thumbnail" },
                    description: { $first: "$description" },
                    lang: { $first: "$lang" },
                    intendedLearners: { $first: "$intendedLearners" },
                    requirements: { $first: "$requirements" },
                    targets: { $first: "$targets" },
                    level: { $first: "$level" },
                    currentPrice: { $first: "$currentPrice" },
                    originalPrice: { $first: "$originalPrice" },
                    saleOff: { $first: "$saleOff" },
                    rating: { $first: "$rating" },
                    author: { $first: "$author" },
                    hashtags: { $first: "$hashtags" },
                    publish: { $first: "$publish" },
                    status: { $first: "$status" },
                    chapters: { $push: "$chapters" },
                }
            },
            {
                $project: {
                    'slug': 1,
                    'name': 1,
                    'category._id': 1,
                    'category.name': 1,
                    'category.slug': 1,
                    'thumbnail': 1,
                    'description': 1,
                    'lang': 1,
                    'intendedLearners': 1,
                    'requirements': 1,
                    'targets': 1,
                    'level': 1,
                    'currentPrice': 1,
                    'originalPrice': 1,
                    'saleOff': 1,
                    'sellNumber': 1,
                    'rating.rate': 1,
                    'rating.numOfRate': 1,
                    'rating.star5': 1,
                    'rating.star4': 1,
                    'rating.star3': 1,
                    'rating.star2': 1,
                    'rating.star1': 1,
                    'author._id': 1,
                    'author.fullName': 1,
                    'hashtags': 1,
                    'publish': 1,
                    'status': 1,
                    'chapters': 1,
                }
            }
        ])
        if (course[0]) {
            if (!course[0].chapters[0].name) { course[0].chapters = [] }
            return res.status(200).json({ message: 'ok', course: course[0] })
        }

        res.status(404).json({ message: 'không tìm thấy' })
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message })
    }
}
//#endregion


// #region lesson

const getLessons = async (req, res, next) => {

}
const postLesson = async (req, res, next) => {
    try {

    } catch (error) {

    }
}
const putLesson = async (req, res, next) => {

}
const deleteLesson = async (req, res, next) => {

}


// #endregion



module.exports = {
    postCourse,
    getCourses,
    putCourse,
    getCourse,
    getRelatedCourses,
    getHotCourses,
    getRates,
    getSuggestCourses,
    deleteCourse,
    getDetailPendingCourse
}