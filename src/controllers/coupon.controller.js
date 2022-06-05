const CouponModel = require('../models/coupon.model');
const helper = require('../helper');
const CodeModel = require('../models/code.model');
const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId;


// fn: lấy danh sách mã và phân trang
const getCoupons = async (req, res, next) => {
    try {
        const { page, limit, active, title } = req.query
        let aQuery = [
            {
                $lookup: {
                    from: 'users',
                    localField: "author",
                    foreignField: "_id",
                    as: "author"
                }
            },
            {
                $unwind: "$author"
            },
            {
                $lookup: {
                    from: 'codes',
                    localField: "_id",
                    foreignField: "coupon",
                    as: "codes"
                }
            },
            {
                $project: {
                    _id: 1,
                    'title': 1,
                    'type': 1,
                    'apply': 1,
                    'amount': 1,
                    'startDate': 1,
                    'expireDate': 1,
                    'maxDiscount': 1,
                    'minPrice': 1,
                    'number': 1,
                    'remain': { $size: { $filter: { 'input': "$codes", "cond": { $eq: ["$$this.isActive", true] } } } },
                    'author._id': 1,
                    'author.fullName': 1,
                }
            }
        ]
        if (active) {
            if (active == 'true') {
                aQuery.unshift({
                    $match: {
                        expireDate: { $gt: new Date() }
                    }
                })
            } else {
                aQuery.unshift({
                    $match: {
                        expireDate: { $lt: new Date() }
                    }
                })
            }
        }
        if (title) {
            aQuery.unshift({
                $match: {
                    title: new RegExp(title, 'img')
                }
            })
        }
        if (page && limit) {
            aQuery.push(
                { $skip: (parseInt(page) - 1) * parseInt(limit) },
                { $limit: parseInt(limit) },
            )
        }
        const coupons = await CouponModel.aggregate(aQuery)
        aQuery.push({ $count: "total" })
        const totalCount = await CouponModel.aggregate(aQuery)
        const total = totalCount[0]?.total || 0

        return res.status(200).json({ message: 'ok', total, coupons })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}

// fn: lấy chi tiết mã
const getCoupon = async (req, res, next) => {
    try {
        const { id } = req.params
        const data = await CouponModel.aggregate([
            { $match: { _id: ObjectId(id) } },
            {
                $lookup: {
                    from: "codes",
                    localField: "_id",
                    foreignField: "coupon",
                    as: 'codes'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: "author",
                    foreignField: "_id",
                    as: "author"
                }
            },
            {
                $unwind: "$author"
            },
            {
                $project: {
                    _id: 1,
                    'title': 1,
                    'type': 1,
                    'apply': 1,
                    'amount': 1,
                    'startDate': 1,
                    'expireDate': 1,
                    'maxDiscount': 1,
                    'minPrice': 1,
                    'number': 1,
                    'remain': { $size: { $filter: { 'input': "$codes", "cond": { $eq: ["$$this.isActive", true] } } } },
                    'author._id': 1,
                    'author.fullName': 1,
                    'codes.code': 1,
                    'codes.isActive': 1,
                }
            }
        ])
        if (data.length == 0) {
            return res.status(400).json({ message: 'coupon không tồn tại' })
        }
        return res.status(200).json({ message: 'ok', coupon: data[0] })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}

// fn: tạo mới mã
const postCoupon = async (req, res, next) => {
    try {
        const user = req.user
        const { title, type, apply, amount, startDate, expireDate, maxDiscount, minPrice, number } = req.body

        const coupon = await CouponModel.create({
            title, type, apply, amount, startDate, expireDate, maxDiscount, minPrice, number, author: user._id
        })
        res.status(201).json({ message: "oke" })
        const codes = helper.generateDiscountCode(10, parseInt(number))
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            await CodeModel.create({
                coupon, code
            })
        }

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })

    }
}

// fn: cập nhật mã
const updateCoupon = async (req, res, next) => {
    try {
        const { id } = req.params
        const { user } = req
        const newCoupon = req.body
        await CouponModel.updateOne({ _id: id, author: user._id }, newCoupon)
        return res.status(200).json({ message: "update ok" })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}

// fn: xoá mã
const deleteCoupon = async (req, res, next) => {
    try {
        const { id } = req.params
        const { account, user } = req
        if (account.role === 'admin') {
            await CouponModel.deleteOne({ _id: id })
        } else {
            await CouponModel.deleteOne({ _id: id, author: user._id })
        }
        await CodeModel.deleteMany({ coupon: id })
        return res.status(200).json({ message: "delete ok" })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}

// fn: xoá nhiều mã
const deleteManyCoupon = async (req, res, next) => {
    try {
        const { ids } = req.body
        const { account, user } = req
        if (account.role === 'admin') {
            await CouponModel.deleteMany({ _id: { $in: ids } })
        } else {
            await CouponModel.deleteMany({ _id: { $in: ids }, author: user._id })
        }
        await CodeModel.deleteMany({ coupon: { $in: ids } })
        return res.status(200).json({ message: "delete ok" })
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message })
    }
}


module.exports = {
    getCoupons,
    getCoupon,
    postCoupon,
    updateCoupon,
    deleteCoupon,
    deleteManyCoupon,
}